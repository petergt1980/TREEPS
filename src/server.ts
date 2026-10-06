import Fastify, { FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import crypto from "node:crypto";
import "dotenv/config";
import { Pool } from "pg";

const app = Fastify({ logger: true, bodyLimit: 256 * 1024 });
const ALLOWED_ORIGINS = new Set([
  "https://gtpstreps.vercel.app",
  "https://gtpstreeps.vercel.app",
]);

app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    return cb(null, false);
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-TREE-PS-SECRET", "X-API-Key"],
  maxAge: 86400,
});


app.options("/api/*", async (_request, reply) => reply.code(204).send());

app.addHook("onResponse", async (request, reply) => {
  if (["POST","PUT","PATCH","DELETE"].includes(request.method) && reply.statusCode < 400) {
    // Vercel Functions may freeze immediately after the response.
    // Persist synchronously so auth/link/game/trading mutations are not lost.
    try {
      await persistStateNow();
    } catch (error) {
      console.error("TREE PS Neon persist failed", error);
    }
  }
});

app.addHook("onRequest", async (request, reply) => {
  // Health/version remain available even when Neon is not configured yet.
  if (request.url === "/" || request.url === "/health" || request.url === "/api/auth/version" || request.url === "/api/system/database") return;
  if (dbReady) return;
  try {
    await ensureDatabase();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database initialization failed.";
    return reply.code(503).send({ success: false, message, code: "DATABASE_NOT_READY" });
  }
});

const PORT = Number(process.env.PORT ?? 3000);
const SHARED_SECRET: string = (process.env.TREE_PS_SHARED_SECRET ?? "").trim();
const SESSION_SECRET = crypto.createHash("sha256").update((process.env.TREE_PS_SESSION_SECRET || SHARED_SECRET || "TREE-PS-LOCAL-SESSION").trim()).digest();

const LINK_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type User = { user_id: number; growid: string; clean_name: string; server: string; is_admin?: boolean; email?: string; web_account_id?: number };
type LinkCode = {
  code: string; createdAt: number; expiresAt: number; used: boolean;
  userId?: number; user?: User; session?: string; webSessionToken?: string;
};
type Wallet = { wl: number; dl: number; bgl: number; ggl: number; gems: number };
type PendingReward = { item_id: number; amount: number; name?: string; image?: string; rarity?: string };
type Session = { user: User; expiresAt: number };
type GameConfig = { id: string; enabled: boolean; title: string; description: string; badge: string; stakes: number[]; maxStake: number; payoutScale: number };
type GachaReward = { id:string; name:string; item_id:number; amount:number; rarity:string; chance:number; image:string };
type GachaChest = { id:string; enabled:boolean; title:string; description:string; badge:string; icon:string; priceLocks:number; rewards:GachaReward[] };
type SiteConfig = {
  siteName: string; tagline: string; accent: string; supportText: string;
  dailyGameLocks: number; gameBonusCooldownHours: number; gameMaxStake: number;
  adminPanelEnabled: boolean; marketRefreshMs: number;
};
type TradeAsset = { symbol:string; name:string; enabled:boolean; priceLocks:number; minOrder:number; maxOrder:number; logoKey:string };
type TradingConfig = { enabled:boolean; feeBps:number; minLocks:number; maxLocks:number; assets:Record<string,TradeAsset> };
type PersistedConfig = { site: SiteConfig; games: Record<string, GameConfig>; assets: Record<string,string>; gacha: Record<string, GachaChest>; trading: TradingConfig };

const DATABASE_URL = (process.env.DATABASE_URL ?? "").trim();
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("neon.tech") || process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
}) : null;

type WebAccount = { id:number; email:string; displayName:string; passwordHash:string; salt:string; createdAt:number; is_admin?:boolean; };
const webAccounts = new Map<string, WebAccount>();
let nextWebAccountId = 100001;

function normalizeEmail(v:unknown){ return String(v||"").trim().toLowerCase(); }
function hashPassword(password:string,salt:string){ return crypto.scryptSync(password,salt,64).toString("hex"); }
function passwordMatches(account:WebAccount,password:string){ return safeEqual(hashPassword(password,account.salt),account.passwordHash); }
function webAccountUser(account:WebAccount):User { return { user_id:0, growid:"", clean_name:account.displayName, server:"TREE PS", email:account.email, web_account_id:account.id, ...(account.is_admin || isAdminEmail(account.email)?{is_admin:true}:{}) }; }
const DEFAULT_GAMES: Record<string, GameConfig> = {
  dice:{id:"dice",enabled:true,title:"DICE",description:"Roll a number 1–100",badge:"HOT",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  crash:{id:"crash",enabled:true,title:"CRASH",description:"Timing & reaction challenge",badge:"POPULAR",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  mines:{id:"mines",enabled:true,title:"MINES",description:"Find safe tiles",badge:"NEW",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  roulette:{id:"roulette",enabled:true,title:"ROULETTE",description:"Spin the visual wheel",badge:"HOT",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  plinko:{id:"plinko",enabled:true,title:"PLINKO",description:"Drop the ball",badge:"NEW",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  coinflip:{id:"coinflip",enabled:true,title:"COIN FLIP",description:"Heads or tails",badge:"POPULAR",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  tower:{id:"tower",enabled:true,title:"TOWER",description:"Climb safe floors",badge:"NEW",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  wheel:{id:"wheel",enabled:true,title:"WHEEL",description:"Spin the free wheel",badge:"HOT",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  hilo:{id:"hilo",enabled:true,title:"HI-LO",description:"Higher or lower cards",badge:"NEW",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  memory:{id:"memory",enabled:true,title:"MEMORY",description:"Match the cards",badge:"POPULAR",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  reaction:{id:"reaction",enabled:true,title:"REACTION",description:"Test response time",badge:"NEW",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1},
  luckywheel:{id:"luckywheel",enabled:true,title:"LUCKY WHEEL",description:"Free cosmetic spin",badge:"HOT",stakes:[10,25,50,100,250,500],maxStake:5000,payoutScale:1}
};
const DEFAULT_SITE: SiteConfig = { siteName:"TREE PS",tagline:"PRIVATE SERVER",accent:"#6b66ff",supportText:"GrowID verified platform",dailyGameLocks:1000,gameBonusCooldownHours:24,gameMaxStake:5000,adminPanelEnabled:true,marketRefreshMs:5000 };
const DEFAULT_GACHA: Record<string,GachaChest> = {
  basic:{id:"basic",enabled:true,title:"BASIC CHEST",description:"A starter chest with common and rare rewards.",badge:"STARTER",icon:"",priceLocks:10,rewards:[
    {id:"b1",name:"World Lock",item_id:242,amount:1,rarity:"COMMON",chance:55,image:""},
    {id:"b2",name:"Diamond Lock",item_id:1796,amount:1,rarity:"RARE",chance:30,image:""},
    {id:"b3",name:"Blue Gem Lock",item_id:7188,amount:1,rarity:"EPIC",chance:12,image:""},
    {id:"b4",name:"Golden Gem Lock",item_id:8470,amount:1,rarity:"LEGENDARY",chance:3,image:""}
  ]},
  premium:{id:"premium",enabled:true,title:"PREMIUM CHEST",description:"A higher-tier chest with stronger internal rewards.",badge:"PREMIUM",icon:"",priceLocks:50,rewards:[
    {id:"p1",name:"Diamond Lock",item_id:1796,amount:1,rarity:"COMMON",chance:45,image:""},
    {id:"p2",name:"Blue Gem Lock",item_id:7188,amount:1,rarity:"RARE",chance:35,image:""},
    {id:"p3",name:"Golden Gem Lock",item_id:8470,amount:1,rarity:"EPIC",chance:17,image:""},
    {id:"p4",name:"Legendary Token",item_id:1320,amount:1,rarity:"LEGENDARY",chance:3,image:""}
  ]},
  legendary:{id:"legendary",enabled:true,title:"LEGENDARY VAULT",description:"The highest-tier collection chest.",badge:"LEGENDARY",icon:"",priceLocks:250,rewards:[
    {id:"l1",name:"Blue Gem Lock",item_id:7188,amount:1,rarity:"COMMON",chance:40,image:""},
    {id:"l2",name:"Golden Gem Lock",item_id:8470,amount:1,rarity:"RARE",chance:35,image:""},
    {id:"l3",name:"Phoenix Item",item_id:1796,amount:5,rarity:"EPIC",chance:20,image:""},
    {id:"l4",name:"Legendary Relic",item_id:242,amount:25,rarity:"LEGENDARY",chance:5,image:""}
  ]}
};
const DEFAULT_TRADING: TradingConfig = { enabled:true, feeBps:0, minLocks:1, maxLocks:5000, assets:{
  BTC:{symbol:"BTC",name:"Bitcoin",enabled:true,priceLocks:1000,minOrder:0.001,maxOrder:1,logoKey:"logo_btc"},
  ETH:{symbol:"ETH",name:"Ethereum",enabled:true,priceLocks:120,minOrder:0.01,maxOrder:10,logoKey:"logo_eth"},
  SOL:{symbol:"SOL",name:"Solana",enabled:true,priceLocks:25,minOrder:0.1,maxOrder:100,logoKey:"logo_sol"},
  LTC:{symbol:"LTC",name:"Litecoin",enabled:true,priceLocks:10,minOrder:0.1,maxOrder:100,logoKey:"logo_ltc"}
}};
const DEFAULT_ASSETS: Record<string,string> = {
  logo_main:"",logo_btc:"",logo_eth:"",logo_sol:"",logo_ltc:"",logo_xau:"",logo_xag:"",logo_forex:"",logo_index:"",logo_stock:"",
  hero_main:"",gacha_banner:"",background_main:"",
  game_dice:"",game_crash:"",game_mines:"",game_roulette:"",game_plinko:"",game_coinflip:"",game_tower:"",game_wheel:"",game_hilo:"",game_memory:"",game_reaction:"",game_luckywheel:""
};

const DEFAULT_PERSISTED: PersistedConfig = { site:{...DEFAULT_SITE}, games:{...DEFAULT_GAMES}, assets:{...DEFAULT_ASSETS}, gacha:{...DEFAULT_GACHA}, trading:{...DEFAULT_TRADING,assets:{...DEFAULT_TRADING.assets}} };
let configStore: PersistedConfig = { ...DEFAULT_PERSISTED, games:{...DEFAULT_GAMES}, assets:{...DEFAULT_ASSETS}, gacha:{...DEFAULT_GACHA}, trading:{...DEFAULT_TRADING, assets:{...DEFAULT_TRADING.assets}}, site:{...DEFAULT_SITE} };

const links = new Map<string, LinkCode>();
const sessions = new Map<string, Session>();
const wallets = new Map<number, Wallet>();
const gameRounds = new Map<string, { userId: number; gameId: string; stake: number; createdAt: number }>();
const gameHistory = new Map<number, Array<{ id:string; gameId:string; outcome:string; at:number }>>();
const pendingGacha = new Map<number, PendingReward[]>();
const gachaHistory = new Map<number, Array<{ id:string; chestId:string; chestTitle:string; entryBalance:number; rewards:PendingReward[]; at:number }>>();
const tradingPortfolios = new Map<number, Record<string, number>>();
const tradingHistory = new Map<number, Array<{id:string;symbol:string;side:"BUY"|"SELL";amount:number;priceLocks:number;grossBalance:number;feeBalance:number;netBalance:number;at:number}>>();
const processedTransactions = new Map<string, { at: number; result: any }>();
const chats: Array<{ id: string; user: string; text: string; time: string }> = [];
const assets = new Map<string, string>();

let persistTimer: NodeJS.Timeout | undefined;
let persistInFlight: Promise<void> | null = null;
let dbReady = false;

function mapToObject<T>(m: Map<number, T>) { return Object.fromEntries(m.entries()); }
function objectToNumberMap<T>(value: unknown): Map<number,T> {
  const out = new Map<number,T>();
  if (!value || typeof value !== "object") return out;
  for (const [k,v] of Object.entries(value as Record<string,T>)) out.set(Number(k), v);
  return out;
}
function mapToArray<T>(m: Map<string,T>) { return [...m.entries()]; }
function arrayToMap<T>(value: unknown): Map<string,T> {
  const out = new Map<string,T>();
  if (!Array.isArray(value)) return out;
  for (const row of value) if (Array.isArray(row) && row.length === 2) out.set(String(row[0]), row[1] as T);
  return out;
}

type DbState = {
  version:number;
  nextWebAccountId:number;
  config:PersistedConfig;
  webAccounts:WebAccount[];
  links:Array<[string,LinkCode]>;
  sessions:Array<[string,Session]>;
  wallets:Record<string,Wallet>;
  gameHistory:Record<string,any[]>;
  pendingGacha:Record<string,PendingReward[]>;
  gachaHistory:Record<string,any[]>;
  tradingPortfolios:Record<string,Record<string,number>>;
  tradingHistory:Record<string,any[]>;
  processedTransactions:Array<[string,{at:number;result:any}]>;
  chats:Array<{id:string;user:string;text:string;time:string}>;
  assets:Record<string,string>;
};

function snapshotState(): DbState {
  return {
    version: 1,
    nextWebAccountId,
    config: configStore,
    webAccounts:[...webAccounts.values()],
    links: mapToArray(links),
    sessions: mapToArray(sessions),
    wallets: mapToObject(wallets),
    gameHistory: mapToObject(gameHistory),
    pendingGacha: mapToObject(pendingGacha),
    gachaHistory: mapToObject(gachaHistory),
    tradingPortfolios: mapToObject(tradingPortfolios),
    tradingHistory: mapToObject(tradingHistory),
    processedTransactions: mapToArray(processedTransactions),
    chats:[...chats],
    assets:Object.fromEntries(assets),
  };
}

function hydrateState(raw:any, options: { includeWallets?: boolean } = {}) {
  const cfg = raw?.config || {};
  configStore = {
    site:{...DEFAULT_SITE,...(cfg.site||{})},
    games:{...DEFAULT_GAMES,...(cfg.games||{})},
    assets:{...DEFAULT_ASSETS,...(cfg.assets||{})},
    gacha:{...DEFAULT_GACHA,...(cfg.gacha||{})},
    trading:{...DEFAULT_TRADING,...(cfg.trading||{}),assets:{...DEFAULT_TRADING.assets,...((cfg.trading||{}).assets||{})}}
  };
  webAccounts.clear();
  if (Array.isArray(raw?.webAccounts)) for (const a of raw.webAccounts) {
    if (a?.email && a?.passwordHash && a?.salt) webAccounts.set(normalizeEmail(a.email), {
      id:Number(a.id)||nextWebAccountId++, email:normalizeEmail(a.email), displayName:String(a.displayName||a.email), passwordHash:String(a.passwordHash), salt:String(a.salt), createdAt:Number(a.createdAt)||Date.now(), is_admin:Boolean(a.is_admin)
    });
  }
  nextWebAccountId = Math.max(Number(raw?.nextWebAccountId)||100001, ...[...webAccounts.values()].map(a=>a.id+1), 100001);
  links.clear(); for (const [k,v] of (Array.isArray(raw?.links)?raw.links:[])) links.set(String(k),v);
  sessions.clear(); for (const [k,v] of (Array.isArray(raw?.sessions)?raw.sessions:[])) sessions.set(String(k),v);
  if (options.includeWallets !== false) {
    wallets.clear();
    for (const [k,v] of Object.entries(raw?.wallets||{})) {
      const rawWallet = v as Partial<Wallet>;
      wallets.set(Number(k), {
        wl: Number.isFinite(Number(rawWallet.wl)) ? Math.max(0, Math.floor(Number(rawWallet.wl))) : 0,
        dl: Number.isFinite(Number(rawWallet.dl)) ? Math.max(0, Math.floor(Number(rawWallet.dl))) : 0,
        bgl: Number.isFinite(Number(rawWallet.bgl)) ? Math.max(0, Math.floor(Number(rawWallet.bgl))) : 0,
        ggl: Number.isFinite(Number(rawWallet.ggl)) ? Math.max(0, Math.floor(Number(rawWallet.ggl))) : 0,
        gems: Number.isFinite(Number(rawWallet.gems)) ? Math.max(0, Math.floor(Number(rawWallet.gems))) : 0,
      });
    }
  }
  for (const [id,chest] of Object.entries(configStore.gacha)) {
    configStore.gacha[id] = { ...chest, priceLocks: Math.max(0, amountValue((chest as any).priceLocks)) };
  }
  gameHistory.clear(); for (const [k,v] of Object.entries(raw?.gameHistory||{})) gameHistory.set(Number(k), v as any[]);
  pendingGacha.clear(); for (const [k,v] of Object.entries(raw?.pendingGacha||{})) pendingGacha.set(Number(k), v as PendingReward[]);
  gachaHistory.clear(); for (const [k,v] of Object.entries(raw?.gachaHistory||{})) gachaHistory.set(Number(k), v as any[]);
  tradingPortfolios.clear(); for (const [k,v] of Object.entries(raw?.tradingPortfolios||{})) tradingPortfolios.set(Number(k), v as Record<string,number>);
  tradingHistory.clear(); for (const [k,v] of Object.entries(raw?.tradingHistory||{})) tradingHistory.set(Number(k), v as any[]);
  processedTransactions.clear(); for (const [k,v] of (Array.isArray(raw?.processedTransactions)?raw.processedTransactions:[])) processedTransactions.set(String(k),v);
  chats.splice(0,chats.length,...(Array.isArray(raw?.chats)?raw.chats.slice(-200):[]));
  assets.clear(); for (const [k,v] of Object.entries(configStore.assets)) assets.set(k,String(v||""));
  for (const [k,v] of Object.entries(raw?.assets||{})) assets.set(k,String(v||""));
}

async function ensureDatabase() {
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  await pool.query(`CREATE TABLE IF NOT EXISTS treeps_state (
    id INTEGER PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS treeps_wallets (
    user_id BIGINT PRIMARY KEY,
    wl BIGINT NOT NULL DEFAULT 0,
    dl BIGINT NOT NULL DEFAULT 0,
    bgl BIGINT NOT NULL DEFAULT 0,
    ggl BIGINT NOT NULL DEFAULT 0,
    gems BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS treeps_gacha_pending (
    user_id BIGINT PRIMARY KEY,
    rewards JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const result = await pool.query<{state:any}>("SELECT state FROM treeps_state WHERE id=1");
  if (result.rowCount && result.rows[0]?.state) {
    hydrateState(result.rows[0].state);
    await migrateLedgerTables();
    dbReady = true;
    console.log("TREE PS: loaded persistent state from Neon PostgreSQL.");
    return;
  }

  // One-time legacy migration from V12 JSON files, when those files exist.
  try {
    const accountFile = `${process.cwd()}/data/treeps-accounts.json`;
    const configFile = `${process.cwd()}/data/treeps-config.json`;
    const fsMod = await import("node:fs");
    if (fsMod.existsSync(accountFile)) {
      const oldAccounts = JSON.parse(fsMod.readFileSync(accountFile,"utf8"));
      if (Array.isArray(oldAccounts)) for (const a of oldAccounts) {
        if (a?.email && a?.passwordHash && a?.salt) webAccounts.set(normalizeEmail(a.email), {...a,email:normalizeEmail(a.email),is_admin:Boolean(a.is_admin)});
      }
    }
    if (fsMod.existsSync(configFile)) {
      const oldConfig = JSON.parse(fsMod.readFileSync(configFile,"utf8"));
      if (oldConfig && typeof oldConfig === "object") {
        configStore = { site:{...DEFAULT_SITE,...(oldConfig.site||{})}, games:{...DEFAULT_GAMES,...(oldConfig.games||{})}, assets:{...DEFAULT_ASSETS,...(oldConfig.assets||{})}, gacha:{...DEFAULT_GACHA,...(oldConfig.gacha||{})}, trading:{...DEFAULT_TRADING,...(oldConfig.trading||{}),assets:{...DEFAULT_TRADING.assets,...((oldConfig.trading||{}).assets||{})}} };
      }
    }
  } catch (error) { console.warn("TREE PS legacy file migration skipped", error); }
  nextWebAccountId = Math.max(nextWebAccountId, ...[...webAccounts.values()].map(a => a.id + 1), 100001);
  assets.clear(); for (const [k,v] of Object.entries(configStore.assets)) assets.set(k,String(v||""));
  dbReady = true;
  await migrateLedgerTables();
  await persistStateNow();
  console.log("TREE PS: initialized persistent state in Neon PostgreSQL.");
}

async function migrateLedgerTables() {
  if (!pool) return;
  const walletCount=await pool.query<{count:string}>(`SELECT COUNT(*)::text AS count FROM treeps_wallets`);
  if (Number(walletCount.rows[0]?.count||0)===0) {
    for (const [userId, wallet] of wallets) {
      const w = normalizeWallet(wallet);
      await pool.query(`INSERT INTO treeps_wallets (user_id,wl,dl,bgl,ggl,gems) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO NOTHING`, [userId,w.wl,w.dl,w.bgl,w.ggl,w.gems]);
    }
  }
  const pendingCount=await pool.query<{count:string}>(`SELECT COUNT(*)::text AS count FROM treeps_gacha_pending`);
  if (Number(pendingCount.rows[0]?.count||0)===0) {
    for (const [userId, rewards] of pendingGacha) {
      await pool.query(`INSERT INTO treeps_gacha_pending (user_id,rewards) VALUES ($1,$2::jsonb) ON CONFLICT (user_id) DO NOTHING`, [userId,JSON.stringify(rewards)]);
    }
  }
}

function saveWebAccounts(){ schedulePersist(); }
function savePersistedConfig(){ schedulePersist(); }

async function persistStateNow() {
  if (!dbReady || !pool) return;
  const state = snapshotState();
  await pool.query(`INSERT INTO treeps_state (id,state,updated_at) VALUES (1,$1,NOW()) ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state, updated_at=NOW()`, [JSON.stringify(state)]);
}
function schedulePersist() {
  if (!dbReady) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistInFlight = persistInFlight ? persistInFlight.then(() => persistStateNow()).catch(() => persistStateNow()) : persistStateNow();
    persistInFlight.catch(error => console.error("TREE PS Neon persist failed", error));
  }, 80);
}


function emptyWallet(): Wallet { return { wl: 0, dl: 0, bgl: 0, ggl: 0, gems: 0 }; }
function normalizeWallet(w: Partial<Wallet> | undefined): Wallet {
  const value = (x: unknown) => Number.isFinite(Number(x)) ? Math.max(0, Math.floor(Number(x))) : 0;
  return { wl:value(w?.wl), dl:value(w?.dl), bgl:value(w?.bgl), ggl:value(w?.ggl), gems:value(w?.gems) };
}
function getWallet(userId: number): Wallet {
  let w = wallets.get(userId);
  if (!w) { w = emptyWallet(); wallets.set(userId, w); }
  else {
    const normalized = normalizeWallet(w);
    if (w.wl !== normalized.wl || w.dl !== normalized.dl || w.bgl !== normalized.bgl || w.ggl !== normalized.ggl || w.gems !== normalized.gems) {
      w = normalized; wallets.set(userId, w);
    }
  }
  return w;
}

async function dbWallet(userId:number): Promise<Wallet> {
  if (!pool) return getWallet(userId);
  const r = await pool.query(`SELECT wl,dl,bgl,ggl,gems FROM treeps_wallets WHERE user_id=$1`, [userId]);
  if (!r.rowCount) {
    const empty=emptyWallet();
    await pool.query(`INSERT INTO treeps_wallets (user_id,wl,dl,bgl,ggl,gems) VALUES ($1,0,0,0,0,0) ON CONFLICT (user_id) DO NOTHING`, [userId]);
    wallets.set(userId, empty);
    return empty;
  }
  const w=normalizeWallet(r.rows[0] as any);
  wallets.set(userId,w);
  return w;
}

async function setDbWallet(userId:number,wallet:Wallet): Promise<Wallet> {
  const w=normalizeWallet(wallet);
  wallets.set(userId,w);
  if (pool) await pool.query(`INSERT INTO treeps_wallets (user_id,wl,dl,bgl,ggl,gems) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET wl=EXCLUDED.wl,dl=EXCLUDED.dl,bgl=EXCLUDED.bgl,ggl=EXCLUDED.ggl,gems=EXCLUDED.gems,updated_at=NOW()`, [userId,w.wl,w.dl,w.bgl,w.ggl,w.gems]);
  return w;
}

async function atomicWalletChange(userId:number, currency:keyof Wallet, delta:number): Promise<Wallet|null> {
  if (!pool) { const w=getWallet(userId); const next=(w[currency]||0)+delta; if(next<0) return null; w[currency]=next; return w; }
  const column=currency;
  const r=await pool.query(`INSERT INTO treeps_wallets (user_id,${column}) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET ${column}=treeps_wallets.${column}+$2,updated_at=NOW() WHERE treeps_wallets.${column}+$2>=0 RETURNING wl,dl,bgl,ggl,gems`, [userId,delta]);
  if(!r.rowCount) return null;
  const w=normalizeWallet(r.rows[0] as any); wallets.set(userId,w); return w;
}

async function persistMutation() {
  if (!dbReady || !pool) return;
  const previous = persistInFlight;
  const job = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => persistStateNow());
  persistInFlight = job;
  await job;
}
function getTradingPortfolio(userId:number){
  let p=tradingPortfolios.get(userId);
  if(!p){ p={}; tradingPortfolios.set(userId,p); }
  return p;
}
function getTradingHistory(userId:number){ return tradingHistory.get(userId) ?? []; }
function safeTradeAmount(v:unknown){ const n=Number(v); return Number.isFinite(n)&&n>0 ? Math.round(n*1_000_000)/1_000_000 : 0; }

function gameOutcome(gameId: string): { outcome: string; multiplier: number } {
  const r = Math.random();
  switch (gameId) {
    case "dice": return r < 0.49 ? { outcome: `WIN ${Math.floor(50 + Math.random()*51)}`, multiplier: 1.9 } : { outcome: `LOSS ${Math.floor(1 + Math.random()*49)}`, multiplier: 0 };
    case "coinflip": return r < 0.5 ? { outcome: "HEADS", multiplier: 1.95 } : { outcome: "TAILS", multiplier: 0 };
    case "roulette": { const n = Math.floor(Math.random()*37); return n === 0 ? { outcome: "GREEN 0", multiplier: 12 } : (r < 0.49 ? { outcome: `${n} • RED`, multiplier: 1.9 } : { outcome: `${n} • BLACK`, multiplier: 1.9 }); }
    case "plinko": { const slots = [0, 0.5, 1, 1.25, 1.5, 2, 3]; const m = slots[Math.floor(Math.random()*slots.length)]; return { outcome: `${m}x`, multiplier: m }; }
    case "crash": { const crash = Number((1 + Math.random()*4).toFixed(2)); const win = crash >= 2; return { outcome: `${crash.toFixed(2)}x`, multiplier: win ? 1.8 : 0 }; }
    case "mines": return r < 0.55 ? { outcome: "SAFE TILE", multiplier: 1.7 } : { outcome: "MINE", multiplier: 0 };
    case "tower": return r < 0.5 ? { outcome: `FLOOR ${Math.floor(2 + Math.random()*8)}`, multiplier: 1.8 } : { outcome: "FAILED", multiplier: 0 };
    case "hilo": return r < 0.48 ? { outcome: "HIGH", multiplier: 1.9 } : { outcome: "LOW", multiplier: 0 };
    case "wheel": { const vals = [0.5, 1, 1.25, 1.5, 2]; const m = vals[Math.floor(Math.random()*vals.length)]; return { outcome: `${m}x`, multiplier: m }; }
    case "luckywheel": { const vals = [1, 1.1, 1.25, 1.5]; const m = vals[Math.floor(Math.random()*vals.length)]; return { outcome: `LUCKY ${m}x`, multiplier: m }; }
    case "memory": return r < 0.6 ? { outcome: "MATCH", multiplier: 1.6 } : { outcome: "MISS", multiplier: 0 };
    case "reaction": { const ms = Math.floor(180 + Math.random()*420); return ms < 420 ? { outcome: `${ms} ms`, multiplier: 1.6 } : { outcome: `${ms} ms`, multiplier: 0 }; }
    default: return { outcome: "PLAYED", multiplier: 1 };
  }
}

function weightedGachaReward(chest:GachaChest): GachaReward {
  const rewards = chest.rewards.filter(r => r.item_id > 0 && r.amount > 0 && r.chance > 0);
  if (!rewards.length) throw new Error("Gacha chest has no valid rewards.");
  const total = rewards.reduce((sum,r)=>sum+Number(r.chance||0),0);
  let roll = Math.random() * total;
  for (const reward of rewards) {
    roll -= Number(reward.chance||0);
    if (roll <= 0) return reward;
  }
  return rewards[rewards.length-1];
}

function normalize(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function makeCode(): string {
  const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `TREE-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}
function bearer(request: FastifyRequest): string | null {
  const m = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function parseJsonBody(body: unknown): any {
  if (body && typeof body === "object") return body;
  if (typeof body !== "string") return {};
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function validLuaSecret(request: FastifyRequest, rawBody: unknown): boolean {
  const body = parseJsonBody(rawBody);
  const token = bearer(request);
  const headerSecret = normalize(request.headers["x-tree-ps-secret"]);
  const altHeaderSecret = normalize(request.headers["x-api-key"]);
  const bodySecret = normalize(body?.api_key ?? body?.secret ?? body?.token);

  const bodyOK = !!bodySecret && safeEqual(bodySecret, SHARED_SECRET);
  const headerOK =
    (!!token && safeEqual(token, SHARED_SECRET)) ||
    (!!headerSecret && safeEqual(headerSecret, SHARED_SECRET)) ||
    (!!altHeaderSecret && safeEqual(altHeaderSecret, SHARED_SECRET));

  return bodyOK || headerOK;
}

// /link has a second authentication factor: the one-time code generated by
// the website. Some GTPS HTTP clients can arrive without custom headers or
// with the JSON body exposed as a raw string. In that case, a syntactically
// valid one-time TREE code is enough to reach the link-code validation below.
function validLinkRequest(request: FastifyRequest, rawBody: unknown): boolean {
  if (validLuaSecret(request, rawBody)) return true;
  const body = parseJsonBody(rawBody);
  const code = normalize(body?.link_code).toUpperCase();
  return /^TREE-[A-F0-9]{4}-[A-F0-9]{4}$/.test(code);
}
function createSession(user: User): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, user, exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  const token = `${payload}.${signature}`;
  sessions.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function decodeSessionToken(token: string): Session | null {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.user || Number(parsed.exp) <= Date.now()) return null;
    return { user: parsed.user as User, expiresAt: Number(parsed.exp) };
  } catch {
    return null;
  }
}

function authSession(request: FastifyRequest): Session | null {
  const token = bearer(request);
  if (!token) return null;
  const stateless = decodeSessionToken(token);
  if (stateless) return stateless;
  const s = sessions.get(token);
  if (!s || Date.now() > s.expiresAt) { sessions.delete(token); return null; }
  return s;
}
function cleanupExpired() {
  const now = Date.now();
  for (const [code, link] of links) if (!link.used && now > link.expiresAt) links.delete(code);
  for (const [token, s] of sessions) if (now > s.expiresAt) sessions.delete(token);
  for (const [tx, data] of processedTransactions) if (now - data.at > 24 * 60 * 60 * 1000) processedTransactions.delete(tx);
}
function autoCleanup() {
  setInterval(cleanupExpired, 60_000).unref();
}
function validCurrency(currency: unknown): currency is keyof Wallet {
  return ["wl", "dl", "bgl", "ggl", "gems"].includes(String(currency).toLowerCase());
}
function amountValue(v: unknown): number {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : 0;
}
function envList(name: string): string[] {
  return String(process.env[name] || "")
    .split(",")
    .map(v => v.trim().replace(/^['\"]|['\"]$/g, "").toLowerCase())
    .filter(Boolean);
}
function isAdminEmail(email:string|undefined){
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const configured = [...envList("TREE_PS_ADMIN_EMAILS"), ...envList("TREE_PS_ADMIN_EMAIL")];
  return configured.includes(normalized);
}
function isAdminUser(user: User): boolean {
  const ids = envList("TREE_PS_ADMIN_USER_IDS");
  const growids = envList("TREE_PS_ADMIN_GROWIDS");
  const account = user.web_account_id ? [...webAccounts.values()].find(a=>a.id===user.web_account_id) : (user.email ? webAccounts.get(String(user.email).toLowerCase()) : undefined);
  return !!account?.is_admin || ids.includes(String(user.user_id)) || growids.includes((user.growid||"").toLowerCase()) || growids.includes((user.clean_name||"").toLowerCase()) || isAdminEmail(user.email);
}
function requireAdmin(request: FastifyRequest): Session | null {
  const s = authSession(request);
  return s && isAdminUser(s.user) ? s : null;
}

async function refreshStateFromDb() {
  if (!pool || !dbReady) return;
  const r=await pool.query<{state:any}>("SELECT state FROM treeps_state WHERE id=1");
  if (r.rowCount && r.rows[0]?.state) hydrateState(r.rows[0].state, { includeWallets: false });
}

function syncAccountAdminFlag(account: WebAccount) {
  for (const [token, session] of sessions) {
    if (session.user.web_account_id === account.id) {
      session.user = { ...session.user, is_admin: Boolean(account.is_admin || isAdminEmail(account.email)) };
      sessions.set(token, session);
    }
  }
}
function publicAccounts() {
  return [...webAccounts.values()].map(a => ({ id:a.id, email:a.email, displayName:a.displayName, createdAt:a.createdAt, is_admin:Boolean(a.is_admin || isAdminEmail(a.email)) }));
}
function publicGameConfigs() { return Object.values(configStore.games).map(g=>({ id:g.id, enabled:g.enabled, title:g.title, description:g.description, badge:g.badge, stakes:g.stakes, maxStake:g.maxStake })); }

// Database initialization is lazy on first API request. This prevents a bad/missing
// DATABASE_URL from crashing the entire Vercel function before /health can respond.
autoCleanup();

app.get("/health", async () => ({ ok: true, service: "tree-ps-backend", version: "TREE-DB-V13", time: new Date().toISOString() }));
app.get("/api/system/database", async () => ({ success:true, provider:"Neon PostgreSQL", persistent:true, browserStorage:"session_token_only", message:"Persistent application data is stored in Neon; localStorage only caches the current session token." }));


app.post("/api/auth/register", async (request, reply) => {
  const body = parseJsonBody(request.body);
  const email = normalizeEmail(body?.email);
  const password = normalize(body?.password);
  const displayName = normalize(body?.displayName) || email.split("@")[0] || "PLAYER";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({success:false,message:"Enter a valid email address."});
  if (password.length < 8) return reply.code(400).send({success:false,message:"Password must be at least 8 characters."});
  if (displayName.length < 2 || displayName.length > 24) return reply.code(400).send({success:false,message:"Display name must be 2-24 characters."});
  if (webAccounts.has(email)) return reply.code(409).send({success:false,message:"An account with this email already exists."});
  const salt = crypto.randomBytes(16).toString("hex");
  const account:WebAccount = {id:nextWebAccountId++,email,displayName,passwordHash:hashPassword(password,salt),salt,createdAt:Date.now()};
  webAccounts.set(email,account); saveWebAccounts();
  const user = webAccountUser(account);
  const token = createSession(user);
  return {success:true,session:token,user,is_admin:isAdminUser(user),requiresGrowIDLink:true};
});

app.post("/api/auth/register/", async (request, reply) => {
  const body = parseJsonBody(request.body);
  const email = normalizeEmail(body?.email);
  const password = normalize(body?.password);
  const displayName = normalize(body?.displayName) || email.split("@")[0] || "PLAYER";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({success:false,message:"Enter a valid email address."});
  if (password.length < 8) return reply.code(400).send({success:false,message:"Password must be at least 8 characters."});
  if (displayName.length < 2 || displayName.length > 24) return reply.code(400).send({success:false,message:"Display name must be 2-24 characters."});
  if (webAccounts.has(email)) return reply.code(409).send({success:false,message:"An account with this email already exists."});
  const salt = crypto.randomBytes(16).toString("hex");
  const account:WebAccount = {id:nextWebAccountId++,email,displayName,passwordHash:hashPassword(password,salt),salt,createdAt:Date.now()};
  webAccounts.set(email,account); saveWebAccounts();
  const user = webAccountUser(account);
  const token = createSession(user);
  return {success:true,session:token,user,is_admin:isAdminUser(user),requiresGrowIDLink:true};
});

app.get("/api/auth/version", async () => ({success:true,version:"TREE-AUTH-V11",register:true,login:true,link:true}));

app.post("/api/auth/login", async (request, reply) => {
  const body = parseJsonBody(request.body);
  const email = normalizeEmail(body?.email);
  const password = normalize(body?.password);
  const account = webAccounts.get(email);
  if (!account || !passwordMatches(account,password)) return reply.code(401).send({success:false,message:"Invalid email or password."});
  const user = webAccountUser(account);
  const token = createSession(user);
  return {success:true,session:token,user,is_admin:isAdminUser(user),requiresGrowIDLink:true};
});

app.get("/api/auth/admin-status", async (request, reply) => {
  await refreshStateFromDb();
  const s = authSession(request);
  if (!s) return reply.code(401).send({ authenticated:false, is_admin:false });
  const email = normalizeEmail(s.user.email);
  const envEmails = [...envList("TREE_PS_ADMIN_EMAILS"), ...envList("TREE_PS_ADMIN_EMAIL")];
  const envEmailMatch = !!email && envEmails.includes(email);
  const account = s.user.web_account_id ? [...webAccounts.values()].find(a => a.id === s.user.web_account_id) : (email ? webAccounts.get(email) : undefined);
  const accountFlag = !!account?.is_admin;
  const growidMatch = envList("TREE_PS_ADMIN_GROWIDS").includes(normalizeEmail(s.user.growid)) || envList("TREE_PS_ADMIN_GROWIDS").includes(normalizeEmail(s.user.clean_name));
  const userIdMatch = envList("TREE_PS_ADMIN_USER_IDS").includes(String(s.user.user_id));
  return { authenticated:true, is_admin: envEmailMatch || accountFlag || growidMatch || userIdMatch, email, envEmailMatch, accountFlag, growidMatch, userIdMatch };
});

app.get("/api/auth/account", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({authenticated:false});
  return {authenticated:true,user:s.user,linked:s.user.user_id>0,is_admin:isAdminUser(s.user),expiresAt:s.expiresAt};
});

app.post("/api/auth/create-link", async (request, reply) => {
  cleanupExpired();
  const now = Date.now();
  const code = makeCode();
  const accountSession = authSession(request);
  links.set(code, { code, createdAt: now, expiresAt: now + LINK_TTL_MS, used: false, webSessionToken: accountSession ? bearer(request) || undefined : undefined });
  return reply.send({ success: true, code, expiresAt: now + LINK_TTL_MS, expiresIn: 600 });
});

const verifyLinkHandler = async (request: FastifyRequest<{ Body: any }>, reply: any) => {
  const body = request.body;
  if (!validLinkRequest(request, body)) return reply.code(400).send({ success: false, message: "Invalid link request." });
  const parsed = parseJsonBody(body);
  cleanupExpired();
  const code = normalize(parsed?.link_code).toUpperCase();
  const userId = amountValue(parsed?.player?.user_id);
  const growid = normalize(parsed?.player?.growid);
  const cleanName = normalize(parsed?.player?.clean_name);
  const server = normalize(parsed?.server?.name) || "TREE PS";
  if (!code || userId <= 0 || !cleanName) return reply.code(400).send({ success: false, message: "Invalid player payload." });
  const link = links.get(code);
  if (!link) return reply.code(404).send({ success: false, message: "Link code not found or expired." });
  if (link.used) return reply.code(409).send({ success: false, message: "Link code already used." });
  if (Date.now() > link.expiresAt) { links.delete(code); return reply.code(410).send({ success: false, message: "Link code expired." }); }

  const linkedWebSession = link.webSessionToken ? (decodeSessionToken(link.webSessionToken) ?? sessions.get(link.webSessionToken) ?? null) : null;
  const email = linkedWebSession?.user.email;
  const webAccountId = linkedWebSession?.user.web_account_id;
  const user: User = { user_id: userId, growid, clean_name: cleanName, server, ...(email ? {email} : {}), ...(webAccountId ? {web_account_id:webAccountId} : {}) };
  if (isAdminUser(user)) user.is_admin = true;
  const session = createSession(user);
  link.used = true; link.userId = userId; link.user = user; link.session = session;
  await dbWallet(userId); // creates a zero wallet only when the player has no wallet

  return { success: true, message: "GrowID linked successfully.", session, user, version: "TREE-DB-V13" };
};

app.post("/api/auth/verify-link", verifyLinkHandler);
app.post("/api/auth/verify-link-v3", verifyLinkHandler);

app.get("/api/auth/link-status", async (request: FastifyRequest<{ Querystring: { code?: string } }>, reply) => {
  cleanupExpired();
  const code = normalize(request.query.code).toUpperCase();
  if (!code) return reply.code(400).send({ success: false, message: "Missing code." });
  const link = links.get(code);
  if (!link) return { success: false, status: "not_found" };
  if (!link.used && Date.now() > link.expiresAt) { links.delete(code); return { success: false, status: "expired" }; }
  if (!link.used) return { success: true, status: "waiting", expiresAt: link.expiresAt, user: null };
  return { success: true, status: "connected", session: link.session, user: link.user };
});

app.get("/api/auth/session", async (request, reply) => {
  await refreshStateFromDb();
  const s = authSession(request);
  if (!s) return reply.code(401).send({ authenticated: false });
  return { authenticated: true, user: { ...s.user, is_admin: isAdminUser(s.user) }, is_admin: isAdminUser(s.user), expiresAt: s.expiresAt };
});
app.post("/api/auth/logout", async (request) => { const token = bearer(request); if (token) sessions.delete(token); return { success: true }; });

app.get("/api/player/profile", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  return { success: true, user: s.user };
});
app.get("/api/player/wallet", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  return { success: true, user_id: s.user.user_id, wallet: await dbWallet(s.user.user_id) };
});
app.get("/api/player/game-wallet", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  // Backward-compatible endpoint exposing the normal wallet balance.
  return { success: true, balance: await dbWallet(s.user.user_id) };
});

app.post("/api/game/bonus", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  return reply.code(410).send({ success: false, message: "Separate game-credit bonuses are disabled. Use the normal wallet balance." });
});

app.post("/api/games/play", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  const body = request.body as any;
  const gameId = normalize(body?.game_id);
  const cfg = configStore.games[gameId];
  if (!cfg || !cfg.enabled) return reply.code(400).send({ success: false, message: "Game is disabled." });
  const cfgStake = Math.max(1, Number((body as any)?.stake || cfg.stakes?.[0] || 1));
  const maxStake = Math.max(1, Number(cfg.maxStake || configStore.site.gameMaxStake || 5000));
  const stake = Math.min(maxStake, Math.floor(cfgStake));
  if (!Number.isFinite(stake) || stake <= 0) return reply.code(400).send({ success:false, message:"Invalid stake." });
  if (Array.isArray(cfg.stakes) && cfg.stakes.length && !cfg.stakes.includes(stake)) return reply.code(400).send({ success:false, message:"Invalid stake amount." });

  const currentWallet = await dbWallet(s.user.user_id);
  if (currentWallet.wl < stake) return reply.code(400).send({ success:false, message:`Not enough WL balance. Need ${stake} WL.`, wallet:currentWallet });
  const debited = await atomicWalletChange(s.user.user_id, "wl", -stake);
  if (!debited) return reply.code(409).send({ success:false, message:"Wallet changed. Refresh and try again.", wallet:await dbWallet(s.user.user_id) });

  const roundId = crypto.randomUUID();
  const out = gameOutcome(gameId);
  const payout = Math.max(0, Math.floor(stake * Math.max(0, Number(out.multiplier || 0)) * Math.max(0, Number(cfg.payoutScale || 1))));
  const wallet = payout > 0 ? await atomicWalletChange(s.user.user_id, "wl", payout) : debited;
  if (!wallet) return reply.code(500).send({ success:false, message:"Wallet payout update failed. The stake was not lost; contact an admin." });

  const history = gameHistory.get(s.user.user_id) ?? [];
  history.unshift({ id: roundId, gameId, outcome: out.outcome, at: Date.now() });
  gameHistory.set(s.user.user_id, history.slice(0, 50));
  await persistMutation();
  return { success: true, round_id: roundId, game_id: gameId, outcome: out.outcome, stake, payout, multiplier: out.multiplier, balance: wallet };
});

app.get("/api/player/game-history", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  return { success: true, items: gameHistory.get(s.user.user_id) ?? [] };
});

app.get("/api/player/inventory", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  return { success: true, user_id: s.user.user_id, items: [] };
});
app.get("/api/player/history", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  return { success: true, items: [] };
});

app.get("/api/trading/config", async (request, reply) => {
  const s=authSession(request); if(!s) return reply.code(401).send({message:"Unauthorized"});
  return {success:true, trading:{enabled:configStore.trading.enabled,feeBps:configStore.trading.feeBps,minLocks:configStore.trading.minLocks,maxLocks:configStore.trading.maxLocks,assets:Object.values(configStore.trading.assets).filter(a=>a.enabled)}};
});
app.get("/api/trading/portfolio", async (request, reply) => {
  const s=authSession(request); if(!s) return reply.code(401).send({message:"Unauthorized"});
  return {success:true, wallet:await dbWallet(s.user.user_id), holdings:getTradingPortfolio(s.user.user_id), history:getTradingHistory(s.user.user_id).slice(-50).reverse()};
});
app.post("/api/trading/order", async (request, reply) => {
  const s=authSession(request); if(!s) return reply.code(401).send({message:"Unauthorized"});
  if(!configStore.trading.enabled) return reply.code(503).send({success:false,message:"Balance Trading is disabled."});
  const body=parseJsonBody(request.body);
  const symbol=normalize(body?.symbol).toUpperCase(); const side=normalize(body?.side).toUpperCase();
  const asset=configStore.trading.assets[symbol]; const amount=safeTradeAmount(body?.amount);
  if(!asset || !asset.enabled || !["BUY","SELL"].includes(side)) return reply.code(400).send({success:false,message:"Invalid trading order."});
  if(amount < asset.minOrder || amount > asset.maxOrder) return reply.code(400).send({success:false,message:`Order amount must be between ${asset.minOrder} and ${asset.maxOrder} ${symbol}.`});
  const gross=Math.max(1,Math.round(amount*asset.priceLocks));
  if(gross < configStore.trading.minLocks || gross > configStore.trading.maxLocks) return reply.code(400).send({success:false,message:"Order size is outside the configured balance limits."});
  const fee=Math.floor(gross*Math.max(0,Number(configStore.trading.feeBps||0))/10000);
  const w=await dbWallet(s.user.user_id); const p=getTradingPortfolio(s.user.user_id);
  p[symbol]=Number(p[symbol]||0);
  if(side==="BUY"){
    const total=gross+fee; if(w.wl<total) return reply.code(400).send({success:false,message:`Not enough WL balance. Need ${total}.`,wallet:w});
    const next=await atomicWalletChange(s.user.user_id,"wl",-total); if(!next) return reply.code(409).send({success:false,message:"Wallet changed. Refresh and try again.",wallet:await dbWallet(s.user.user_id)});
    w.wl=next.wl; p[symbol]=Math.round((p[symbol]+amount)*1_000_000)/1_000_000;
  }else{
    if(p[symbol] < amount) return reply.code(400).send({success:false,message:`Insufficient ${symbol} holdings.`});
    const next=await atomicWalletChange(s.user.user_id,"wl",Math.max(0,gross-fee)); if(!next) return reply.code(500).send({success:false,message:"Wallet update failed."});
    w.wl=next.wl; p[symbol]=Math.round((p[symbol]-amount)*1_000_000)/1_000_000;
  }
  const item={id:crypto.randomUUID(),symbol,side:side as "BUY"|"SELL",amount,priceLocks:asset.priceLocks,grossBalance:gross,feeBalance:fee,netBalance:side==="BUY"?-(gross+fee):(gross-fee),at:Date.now()};
  const h=tradingHistory.get(s.user.user_id)||[]; h.unshift(item); tradingHistory.set(s.user.user_id,h.slice(0,100));
  await persistMutation();
  return {success:true,order:item,wallet:w,holdings:p};
});
app.get("/api/player/trading-history", async (request, reply) => {
  const s=authSession(request); if(!s) return reply.code(401).send({message:"Unauthorized"});
  return {success:true,items:getTradingHistory(s.user.user_id).slice(0,100)};
});

app.get("/api/gacha/config", async (request, reply) => {
  if (!authSession(request)) return reply.code(401).send({ message: "Unauthorized" });
  return { success:true, chests:Object.values(configStore.gacha).filter(c=>c.enabled), site:{ gachaEnabled:true } };
});

app.post("/api/gacha/spin", async (request, reply) => {
  const s = authSession(request);
  if (!s) return reply.code(401).send({ message: "Unauthorized" });
  const body = parseJsonBody(request.body);
  const chestId = normalize(body?.chest_id);
  const count = Math.max(1, Math.min(10, amountValue(body?.count) || 1));
  const chest = configStore.gacha[chestId];
  if (!chest || !chest.enabled) return reply.code(404).send({ success:false, message:"Gacha chest unavailable." });
  if (!Array.isArray(chest.rewards) || chest.rewards.length === 0) return reply.code(400).send({ success:false, message:"This chest has no rewards." });
  const cost = Math.max(0, Math.floor(Number(chest.priceLocks || 0) * count));
  const currentWallet = await dbWallet(s.user.user_id);
  if (currentWallet.wl < cost) return reply.code(400).send({ success:false, message:`Not enough WL balance. Need ${cost} WL.`, wallet:currentWallet });
  const wallet = cost > 0 ? await atomicWalletChange(s.user.user_id,"wl",-cost) : currentWallet;
  if (!wallet) return reply.code(409).send({ success:false, message:"Wallet changed. Refresh and try again.", wallet:await dbWallet(s.user.user_id) });
  const rewards: PendingReward[] = [];
  for (let i=0;i<count;i++) {
    const r = weightedGachaReward(chest);
    rewards.push({item_id:r.item_id, amount:r.amount, name:r.name, image:r.image || undefined, rarity:r.rarity});
  }
  let mergedPending:PendingReward[];
  if (pool) {
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const row=await client.query(`SELECT rewards FROM treeps_gacha_pending WHERE user_id=$1 FOR UPDATE`,[s.user.user_id]);
      const existing=Array.isArray(row.rows[0]?.rewards)?row.rows[0].rewards as PendingReward[]:[];
      mergedPending=[...existing,...rewards];
      await client.query(`INSERT INTO treeps_gacha_pending (user_id,rewards) VALUES ($1,$2::jsonb) ON CONFLICT (user_id) DO UPDATE SET rewards=EXCLUDED.rewards,updated_at=NOW()`,[s.user.user_id,JSON.stringify(mergedPending)]);
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } else {
    const existing = pendingGacha.get(s.user.user_id) ?? [];
    mergedPending=[...existing,...rewards];
  }
  pendingGacha.set(s.user.user_id, mergedPending);
  const history = gachaHistory.get(s.user.user_id) ?? [];
  history.unshift({id:crypto.randomUUID(),chestId:chest.id,chestTitle:chest.title,entryBalance:cost,rewards,at:Date.now()});
  gachaHistory.set(s.user.user_id, history.slice(0,50));
  await persistMutation();
  return { success:true, chest:{id:chest.id,title:chest.title}, count, cost, rewards, wallet };
});

app.get("/api/player/gacha-history", async (request, reply) => {
  const s = authSession(request);
  if (!s) return reply.code(401).send({ message:"Unauthorized" });
  return { success:true, items:gachaHistory.get(s.user.user_id) ?? [] };
});

app.get("/api/gacha/pending", async (request, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  if (pool) { const r=await pool.query(`SELECT rewards FROM treeps_gacha_pending WHERE user_id=$1`,[s.user.user_id]); const rewards=Array.isArray(r.rows[0]?.rewards)?r.rows[0].rewards:[]; pendingGacha.set(s.user.user_id,rewards); return {success:true,rewards}; }
  return { success: true, rewards: pendingGacha.get(s.user.user_id) ?? [] };
});

// Development/admin helper: seed a pending in-game reward.
app.post("/api/admin/gacha/seed", async (request, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({ success:false, message:"Admin access required." });
  const body = parseJsonBody(request.body);
  const userId = amountValue(body?.user_id);
  const itemId = amountValue(body?.item_id);
  const amount = amountValue(body?.amount);
  if (userId <= 0 || itemId <= 0 || amount <= 0) return reply.code(400).send({ success:false, message:"Invalid reward." });
  const reward: PendingReward = { item_id:itemId, amount, name:normalize(body?.name)||undefined, image:normalize(body?.image)||undefined, rarity:normalize(body?.rarity)||undefined };
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query(`SELECT rewards FROM treeps_gacha_pending WHERE user_id=$1 FOR UPDATE`, [userId]);
      const existing = Array.isArray(row.rows[0]?.rewards) ? row.rows[0].rewards as PendingReward[] : [];
      const list = [...existing, reward];
      await client.query(`INSERT INTO treeps_gacha_pending (user_id,rewards) VALUES ($1,$2::jsonb) ON CONFLICT (user_id) DO UPDATE SET rewards=EXCLUDED.rewards,updated_at=NOW()`, [userId, JSON.stringify(list)]);
      await client.query("COMMIT");
      pendingGacha.set(userId, list);
      return { success:true, rewards:list };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const list = [...(pendingGacha.get(userId) ?? []), reward];
  pendingGacha.set(userId, list);
  return { success:true, rewards:list };
});

// Lua asks for pending rewards and consumes them once. The Lua script can restore them on a partial claim failure.
app.post("/api/lua/gacha-claim", async (request: FastifyRequest<{ Body: any }>, reply) => {
  const body = parseJsonBody(request.body);
  if (!validLuaSecret(request, body)) return reply.code(401).send({ success: false, message: "Unauthorized request." });
  const userId = amountValue(body?.user_id);
  if (userId <= 0) return reply.code(400).send({ success: false, message: "Invalid user ID." });
  if (pool) {
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const row=await client.query(`SELECT rewards FROM treeps_gacha_pending WHERE user_id=$1 FOR UPDATE`,[userId]);
      const rewards=Array.isArray(row.rows[0]?.rewards)?row.rows[0].rewards:[];
      if (rewards.length) await client.query(`DELETE FROM treeps_gacha_pending WHERE user_id=$1`,[userId]);
      await client.query("COMMIT");
      pendingGacha.set(userId,rewards as PendingReward[]);
      return reply.type("application/json").send({ success:true, rewards });
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  const rewards = pendingGacha.get(userId) ?? [];
  if (!rewards.length) return { success: true, rewards: [] };
  pendingGacha.set(userId, []);
  return { success: true, rewards };
});
app.post("/api/lua/gacha-restore", async (request: FastifyRequest<{ Body: any }>, reply) => {
  const body = parseJsonBody(request.body);
  if (!validLuaSecret(request, body)) return reply.code(401).send({ success:false, message:"Unauthorized request." });
  const userId = amountValue(body?.user_id);
  const rewards = Array.isArray(body?.rewards) ? body.rewards : [];
  if (userId <= 0) return reply.code(400).send({ success:false, message:"Invalid user ID." });
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const row = await client.query(`SELECT rewards FROM treeps_gacha_pending WHERE user_id=$1 FOR UPDATE`, [userId]);
      const existing = Array.isArray(row.rows[0]?.rewards) ? row.rows[0].rewards as PendingReward[] : [];
      const merged = [...rewards, ...existing];
      await client.query(`INSERT INTO treeps_gacha_pending (user_id,rewards) VALUES ($1,$2::jsonb) ON CONFLICT (user_id) DO UPDATE SET rewards=EXCLUDED.rewards,updated_at=NOW()`, [userId, JSON.stringify(merged)]);
      await client.query("COMMIT");
      pendingGacha.set(userId, merged);
      return { success:true, rewards:merged };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const existing = pendingGacha.get(userId) ?? [];
  const merged = [...rewards, ...existing];
  pendingGacha.set(userId, merged);
  return { success:true, rewards:merged };
});

const currencyMap = { wl: "wl", dl: "dl", bgl: "bgl", ggl: "ggl" } as const;

app.post("/api/lua/deposit", async (request: FastifyRequest<{ Body: any }>, reply) => {
  const body = parseJsonBody(request.body);
  if (!validLuaSecret(request, body)) return reply.code(401).send({ success: false, message: "Unauthorized request." });
  const tx = normalize(body?.transaction_id); const userId = amountValue(body?.user_id); const currency = String(body?.currency ?? "").toLowerCase(); const amount = amountValue(body?.amount);
  if (!tx || userId <= 0 || !Object.hasOwn(currencyMap, currency) || amount <= 0) return reply.code(400).send({ success: false, message: "Invalid deposit payload." });
  const processed = processedTransactions.get(tx); if (processed) return processed.result;
  const wallet = await atomicWalletChange(userId, currency as keyof Wallet, amount);
  if (!wallet) return reply.code(500).send({ success:false, message:"Wallet update failed." });
  const result = { success: true, action: "deposit", currency, amount, wallet };
  processedTransactions.set(tx, { at: Date.now(), result });
  await persistMutation();
  return result;
});

app.post("/api/lua/withdraw", async (request: FastifyRequest<{ Body: any }>, reply) => {
  const body = parseJsonBody(request.body);
  if (!validLuaSecret(request, body)) return reply.code(401).send({ success: false, message: "Unauthorized request." });
  const tx = normalize(body?.transaction_id); const userId = amountValue(body?.user_id); const currency = String(body?.currency ?? "").toLowerCase(); const amount = amountValue(body?.amount);
  if (!tx || userId <= 0 || !Object.hasOwn(currencyMap, currency) || amount <= 0) return reply.code(400).send({ success: false, message: "Invalid withdrawal payload." });
  const processed = processedTransactions.get(tx); if (processed) return processed.result;
  const before = await dbWallet(userId); const key = currency as keyof Wallet;
  if (before[key] < amount) return reply.code(400).send({ success: false, message: "Insufficient web balance.", wallet:before });
  const wallet = await atomicWalletChange(userId, key, -amount);
  if (!wallet) return reply.code(409).send({ success:false, message:"Wallet changed. Refresh and try again.", wallet:await dbWallet(userId) });
  const result = { success: true, action: "withdraw", currency, amount, wallet };
  processedTransactions.set(tx, { at: Date.now(), result });
  await persistMutation();
  return result;
});

app.post("/api/lua/withdraw-rollback", async (request: FastifyRequest<{ Body: any }>, reply) => {
  const body = parseJsonBody(request.body);
  if (!validLuaSecret(request, body)) return reply.code(401).send({ success: false, message: "Unauthorized request." });
  const tx = normalize(body?.transaction_id); const userId = amountValue(body?.user_id); const currency = String(body?.currency ?? "").toLowerCase(); const amount = amountValue(body?.amount);
  if (!tx || userId <= 0 || !Object.hasOwn(currencyMap, currency) || amount <= 0) return reply.code(400).send({ success: false, message: "Invalid rollback payload." });
  const wallet = await atomicWalletChange(userId, currency as keyof Wallet, amount);
  if (!wallet) return reply.code(500).send({ success:false, message:"Wallet rollback failed." });
  await persistMutation();
  return { success: true, action: "withdraw_rollback", currency, amount, wallet };
});

app.get("/api/games/config", async () => ({ success:true, site:{ gameBalanceMode:true }, games:publicGameConfigs() }));
app.get("/api/config/site", async () => ({ success:true, site:configStore.site }));

app.get("/api/admin/accounts", async (request: FastifyRequest, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({success:false,message:"Admin access required."});
  return {success:true, accounts:publicAccounts(), admins:publicAccounts().filter(a=>a.is_admin)};
});

app.post("/api/admin/admins", async (request, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({success:false,message:"Admin access required."});
  const body = parseJsonBody(request.body);
  const email = normalizeEmail(body?.email);
  if (!email) return reply.code(400).send({success:false,message:"Email is required."});
  const account = webAccounts.get(email);
  if (!account) return reply.code(404).send({success:false,message:"Web account not found. The user must register first."});
  account.is_admin = true;
  webAccounts.set(email, account);
  saveWebAccounts();
  syncAccountAdminFlag(account);
  return {success:true, account:publicAccounts().find(a=>a.id===account.id), admins:publicAccounts().filter(a=>a.is_admin)};
});

app.delete("/api/admin/admins/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const current = requireAdmin(request);
  if (!current) return reply.code(403).send({success:false,message:"Admin access required."});
  const id = Number(request.params.id);
  const account = [...webAccounts.values()].find(a=>a.id===id);
  if (!account) return reply.code(404).send({success:false,message:"Admin account not found."});
  if (current.user.web_account_id === account.id) return reply.code(400).send({success:false,message:"You cannot remove your own admin access."});
  if (isAdminEmail(account.email)) return reply.code(400).send({success:false,message:"This admin is configured in backend/.env and cannot be removed from the panel."});
  account.is_admin = false;
  webAccounts.set(account.email, account);
  saveWebAccounts();
  syncAccountAdminFlag(account);
  return {success:true, account:publicAccounts().find(a=>a.id===account.id), admins:publicAccounts().filter(a=>a.is_admin)};
});

app.get("/api/admin/state", async (request, reply) => {
  await refreshStateFromDb();
  const s = requireAdmin(request);
  if (!s) return reply.code(403).send({ success:false, message:"Admin access required." });
  return { success:true, is_admin:true, user:s.user, site:configStore.site, games:Object.values(configStore.games), assets:Object.fromEntries(assets), gacha:Object.values(configStore.gacha), trading:configStore.trading, markets:MARKET_CONFIGS, accounts:publicAccounts(), admins:publicAccounts().filter(a=>a.is_admin) };
});
app.put("/api/admin/settings", async (request: FastifyRequest<{ Body: any }>, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({ success:false, message:"Admin access required." });
  const body = parseJsonBody(request.body);
  if (body.site && typeof body.site === "object") configStore.site = { ...configStore.site, ...body.site, gameMaxStake:Math.max(1,amountValue(body.site.gameMaxStake)||configStore.site.gameMaxStake) };
  savePersistedConfig();
  return { success:true, site:configStore.site };
});
app.put("/api/admin/games/:id", async (request:FastifyRequest<{Params:{id:string};Body:any}>, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({ success:false, message:"Admin access required." });
  const id=normalize(request.params.id); const current=configStore.games[id]; if(!current) return reply.code(404).send({success:false,message:"Unknown game."});
  const body=parseJsonBody(request.body);
  const stakes=Array.isArray(body.stakes)?body.stakes.map((n:any)=>amountValue(n)).filter((n:number)=>n>0&&n<=100000).slice(0,12):current.stakes;
  configStore.games[id]={...current,...body,id,stakes,maxStake:Math.max(1,amountValue(body.maxStake)||current.maxStake),payoutScale:Math.max(0,Math.min(10,Number(body.payoutScale??current.payoutScale)||1))};
  savePersistedConfig(); return {success:true,game:configStore.games[id]};
});

app.post("/api/admin/gacha/chests", async (request: FastifyRequest<{ Body: any }>, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({success:false,message:"Admin access required."});
  const body = parseJsonBody(request.body);
  const id = normalize(body.id).toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0,32);
  if (!id) return reply.code(400).send({success:false,message:"Invalid chest id."});
  if (configStore.gacha[id]) return reply.code(409).send({success:false,message:"Chest already exists."});
  const rewards = Array.isArray(body.rewards) ? body.rewards.map((r:any,i:number)=>({id:normalize(r.id)||`${id}-${i+1}`,name:normalize(r.name)||`Reward ${i+1}`,item_id:amountValue(r.item_id),amount:amountValue(r.amount),rarity:normalize(r.rarity)||"COMMON",chance:Number(r.chance)||0,image:normalize(r.image)})).filter((r:any)=>r.item_id>0&&r.amount>0&&r.chance>0).slice(0,20) : [];
  configStore.gacha[id]={id,enabled:body.enabled!==false,title:normalize(body.title)||id.toUpperCase(),description:normalize(body.description)||"TREE PS Gacha Chest",badge:normalize(body.badge)||"NEW",icon:normalize(body.icon),priceLocks:Math.max(0,amountValue(body.priceLocks)),rewards};
  savePersistedConfig();
  return {success:true,gacha:configStore.gacha[id]};
});

app.put("/api/admin/gacha/:id", async (request:FastifyRequest<{Params:{id:string};Body:any}>, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({success:false,message:"Admin access required."});
  const id=normalize(request.params.id); const current=configStore.gacha[id];
  if (!current) return reply.code(404).send({success:false,message:"Unknown gacha chest."});
  const body=parseJsonBody(request.body);
  const rewards=Array.isArray(body.rewards)?body.rewards.map((r:any,i:number)=>({id:normalize(r.id)||`${id}-${i+1}`,name:normalize(r.name)||`Reward ${i+1}`,item_id:amountValue(r.item_id),amount:amountValue(r.amount),rarity:normalize(r.rarity)||"COMMON",chance:Number(r.chance)||0,image:normalize(r.image)})).filter((r:any)=>r.item_id>0&&r.amount>0&&r.chance>0).slice(0,20):current.rewards;
  configStore.gacha[id]={...current,...body,id,priceLocks:Math.max(0,amountValue(body.priceLocks ?? current.priceLocks)),rewards};
  savePersistedConfig();
  return {success:true,gacha:configStore.gacha[id]};
});

app.delete("/api/admin/gacha/:id", async (request:FastifyRequest<{Params:{id:string}}>, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({success:false,message:"Admin access required."});
  const id=normalize(request.params.id); if(!configStore.gacha[id]) return reply.code(404).send({success:false,message:"Unknown gacha chest."});
  delete configStore.gacha[id]; savePersistedConfig();
  return {success:true,gacha:Object.values(configStore.gacha)};
});

app.put("/api/admin/trading/settings", async (request: FastifyRequest<{ Body: any }>, reply) => {
  if(!requireAdmin(request)) return reply.code(403).send({success:false,message:"Admin access required."});
  const body=parseJsonBody(request.body);
  if(body.enabled!==undefined) configStore.trading.enabled=Boolean(body.enabled);
  if(body.feeBps!==undefined) configStore.trading.feeBps=Math.max(0,Math.min(1000,Number(body.feeBps)||0));
  if(body.minLocks!==undefined) configStore.trading.minLocks=Math.max(1,amountValue(body.minLocks)||1);
  if(body.maxLocks!==undefined) configStore.trading.maxLocks=Math.max(configStore.trading.minLocks,amountValue(body.maxLocks)||configStore.trading.maxLocks);
  savePersistedConfig(); return {success:true,trading:configStore.trading};
});
app.put("/api/admin/trading/assets/:symbol", async (request: FastifyRequest<{ Params: { symbol: string }; Body: any }>, reply) => {
  if(!requireAdmin(request)) return reply.code(403).send({success:false,message:"Admin access required."});
  const symbol=normalize(request.params.symbol).toUpperCase(); const current=configStore.trading.assets[symbol];
  if(!current) return reply.code(404).send({success:false,message:"Unknown trading asset."});
  const body=parseJsonBody(request.body);
  configStore.trading.assets[symbol]={...current,...body,symbol,priceLocks:Math.max(1,amountValue(body.priceLocks)||current.priceLocks),minOrder:Math.max(0.000001,Number(body.minOrder??current.minOrder)||current.minOrder),maxOrder:Math.max(Number(body.minOrder??current.minOrder)||current.minOrder,Number(body.maxOrder??current.maxOrder)||current.maxOrder)};
  savePersistedConfig(); return {success:true,asset:configStore.trading.assets[symbol]};
});

app.get("/api/chat/history", async (request, reply) => { if (!authSession(request)) return reply.code(401).send({ message: "Unauthorized" }); return { success: true, messages: chats.slice(-100) }; });
app.post("/api/chat/message", async (request: FastifyRequest<{ Body: { text?: string } }>, reply) => {
  const s = authSession(request); if (!s) return reply.code(401).send({ message: "Unauthorized" });
  const text = normalize(request.body?.text); if (!text || text.length > 250) return reply.code(400).send({ message: "Invalid message." });
  const message = { id: crypto.randomUUID(), user: s.user.clean_name, text, time: new Date().toISOString() }; chats.push(message); if (chats.length > 200) chats.shift(); return { success: true, message };
});

app.get("/api/config/assets", async () => ({ success: true, assets: Object.fromEntries(assets) }));
app.put("/api/admin/assets/:key", async (request: FastifyRequest<{ Params: { key: string }; Body: { url?: string } }>, reply) => {
  if (!requireAdmin(request)) return reply.code(403).send({ success:false, message:"Admin access required." });
  const key = normalize(request.params.key), url = normalize(request.body?.url);
  if (!key || !url) return reply.code(400).send({ success: false, message: "Missing asset key or URL." });
  assets.set(key, url); configStore.assets[key]=url; savePersistedConfig(); return { success: true, key, url };
});

type MarketCategory = "CRYPTO" | "FOREX" | "COMMODITY" | "INDEX" | "STOCK";
type MarketConfig = { symbol: string; category: MarketCategory; provider: "binance" | "yahoo"; providerSymbol: string; binanceSymbol?: string };
type CandlePoint = { time: number; price: number };
type MarketSnapshot = { symbol: string; category: MarketCategory; provider: string; status: "LIVE" | "REFERENCE"; price: number; changePercent: number; high: number | null; low: number | null; volume: number | null; timestamp: number; points: CandlePoint[]; error?: string };

const MARKET_CONFIGS: MarketConfig[] = [
  { symbol: "BTC/USD", category: "CRYPTO", provider: "binance", providerSymbol: "BTCUSDT", binanceSymbol: "BTCUSDT" },
  { symbol: "ETH/USD", category: "CRYPTO", provider: "binance", providerSymbol: "ETHUSDT", binanceSymbol: "ETHUSDT" },
  { symbol: "SOL/USD", category: "CRYPTO", provider: "binance", providerSymbol: "SOLUSDT", binanceSymbol: "SOLUSDT" },
  { symbol: "LTC/USD", category: "CRYPTO", provider: "binance", providerSymbol: "LTCUSDT", binanceSymbol: "LTCUSDT" },
  { symbol: "EUR/USD", category: "FOREX", provider: "yahoo", providerSymbol: "EURUSD=X" },
  { symbol: "GBP/USD", category: "FOREX", provider: "yahoo", providerSymbol: "GBPUSD=X" },
  { symbol: "USD/JPY", category: "FOREX", provider: "yahoo", providerSymbol: "JPY=X" },
  { symbol: "XAU/USD", category: "COMMODITY", provider: "yahoo", providerSymbol: "GC=F" },
  { symbol: "XAG/USD", category: "COMMODITY", provider: "yahoo", providerSymbol: "SI=F" },
  { symbol: "SPX", category: "INDEX", provider: "yahoo", providerSymbol: "^GSPC" },
  { symbol: "NDX", category: "INDEX", provider: "yahoo", providerSymbol: "^NDX" },
  { symbol: "AAPL", category: "STOCK", provider: "yahoo", providerSymbol: "AAPL" },
  { symbol: "MSFT", category: "STOCK", provider: "yahoo", providerSymbol: "MSFT" },
  { symbol: "NVDA", category: "STOCK", provider: "yahoo", providerSymbol: "NVDA" }
];

const marketCache = new Map<string, { at: number; data: MarketSnapshot }>();
const MARKET_CACHE_MS = 5000;

function marketConfig(symbol?: string): MarketConfig | undefined {
  const wanted = normalize(symbol).toUpperCase();
  return MARKET_CONFIGS.find((m) => m.symbol.toUpperCase() === wanted);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function getBinanceMarket(config: MarketConfig): Promise<MarketSnapshot> {
  const base = "https://data-api.binance.vision/api/v3";
  const [tickerRes, klinesRes] = await Promise.all([
    fetch(`${base}/ticker/24hr?symbol=${encodeURIComponent(config.providerSymbol)}`, { signal: AbortSignal.timeout(8000) }),
    fetch(`${base}/klines?symbol=${encodeURIComponent(config.providerSymbol)}&interval=1m&limit=120`, { signal: AbortSignal.timeout(8000) })
  ]);
  if (!tickerRes.ok || !klinesRes.ok) throw new Error(`Binance HTTP ${tickerRes.status}/${klinesRes.status}`);
  const ticker = await tickerRes.json() as any;
  const klines = await klinesRes.json() as any[];
  const points: CandlePoint[] = klines.map((k) => ({ time: Number(k[0]), price: Number(k[4]) })).filter((p) => p.time && Number.isFinite(p.price));
  return {
    symbol: config.symbol, category: config.category, provider: "Binance public market data", status: "LIVE",
    price: Number(ticker.lastPrice), changePercent: Number(ticker.priceChangePercent), high: Number(ticker.highPrice), low: Number(ticker.lowPrice),
    volume: Number(ticker.volume), timestamp: Date.now(), points
  };
}

async function getYahooMarket(config: MarketConfig): Promise<MarketSnapshot> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(config.providerSymbol)}?interval=5m&range=1d&includePrePost=false&events=div%2Csplits`;
  const res = await fetch(url, { headers: { "User-Agent": "TREE-PS/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const body = await res.json() as any;
  const result = body?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo returned no market data");
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const timestamps = result?.timestamp ?? [];
  const points: CandlePoint[] = timestamps.map((t: number, i: number) => ({ time: t * 1000, price: Number(closes[i]) })).filter((p: CandlePoint) => p.time && Number.isFinite(p.price));
  const meta = result.meta ?? {};
  const price = num(meta.regularMarketPrice) ?? points.at(-1)?.price ?? 0;
  const previous = num(meta.previousClose) ?? num(meta.chartPreviousClose);
  const changePercent = previous && previous !== 0 ? ((price - previous) / previous) * 100 : 0;
  return {
    symbol: config.symbol, category: config.category, provider: "Yahoo Finance chart feed", status: "REFERENCE", price, changePercent,
    high: num(meta.regularMarketDayHigh), low: num(meta.regularMarketDayLow), volume: num(meta.regularMarketVolume), timestamp: Date.now(), points
  };
}

async function loadMarket(symbol: string): Promise<MarketSnapshot> {
  const config = marketConfig(symbol);
  if (!config) throw new Error(`Unknown market symbol: ${symbol}`);
  const cached = marketCache.get(config.symbol);
  if (cached && Date.now() - cached.at < MARKET_CACHE_MS) return cached.data;
  try {
    const data = config.provider === "binance" ? await getBinanceMarket(config) : await getYahooMarket(config);
    marketCache.set(config.symbol, { at: Date.now(), data });
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Market feed unavailable";
    if (cached?.data) return { ...cached.data, status: cached.data.status, error: message };
    return { symbol: config.symbol, category: config.category, provider: config.provider === "binance" ? "Binance public market data" : "Yahoo Finance chart feed", status: config.provider === "binance" ? "LIVE" : "REFERENCE", price: 0, changePercent: 0, high: null, low: null, volume: null, timestamp: Date.now(), points: [], error: message };
  }
}

app.get("/api/markets", async (_request, reply) => {
  const results = await Promise.all(MARKET_CONFIGS.map((m) => loadMarket(m.symbol)));
  return reply.send({ success: true, fetchedAt: Date.now(), sourceNote: "Crypto uses Binance public market data. FX, commodities, indices and stocks use Yahoo Finance chart data and may be delayed outside the exchange's live feed.", markets: results.map(({ points, ...summary }) => summary) });
});

app.get("/api/markets/:symbol", async (request: FastifyRequest<{ Params: { symbol: string } }>, reply) => {
  const symbol = decodeURIComponent(normalize(request.params.symbol));
  const config = marketConfig(symbol);
  if (!config) return reply.code(404).send({ success: false, message: "Unknown market symbol." });
  const data = await loadMarket(config.symbol);
  return reply.send({ success: true, fetchedAt: Date.now(), market: data });
});

export default app;
export { app };
