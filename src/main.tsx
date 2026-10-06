import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, BarChart3, Bell, Boxes, Check, ChevronDown, ChevronRight, CircleDollarSign,
  Dice5, Gift, Globe2, Gamepad2, LayoutDashboard, Menu, MessageCircle, Moon, Search,
  Settings, Shield, ShieldCheck, Sparkles, Sun, Trophy, UserRound, Wallet, X, RotateCcw, Play, Send,
  TrendingUp, Layers3, KeyRound, SlidersHorizontal, Image, Save, Power, Percent, Gem
} from "lucide-react";
import "./styles.css";

const API_ORIGIN = import.meta.env.DEV ? "http://localhost:3000" : "";
console.info("[TREE-PS V42] API ORIGIN:", API_ORIGIN || "same-origin /api");
(window as any).__TREE_PS_BUILD__ = "V41";

type User = { user_id?: number; growid?: string; clean_name?: string; server?: string; is_admin?: boolean; email?: string; web_account_id?: number };
type Session = { token: string; user: User };
type WalletBalance = { wl:number; dl:number; bgl:number; ggl:number; gems:number };
type MarketPoint = { time:number; price:number };
type MarketSummary = { symbol:string; category:string; provider:string; status:"LIVE"|"REFERENCE"; price:number; changePercent:number; high:number|null; low:number|null; volume:number|null; timestamp:number; error?:string };
type MarketDetail = MarketSummary & { points:MarketPoint[] };
type LinkStatus = { success: boolean; status: "waiting" | "connected" | "expired" | "not_found"; expiresAt?: number; session?: string; user?: User | null };

type Game = { id: string; title: string; description: string; badge: string; icon: React.ReactNode; cls: string };
type GameConfig = { id:string; enabled:boolean; title:string; description:string; badge:string; stakes:number[]; maxStake:number; payoutScale?:number };
type SiteConfig = { siteName:string; tagline:string; accent:string; supportText:string; adminPanelEnabled:boolean; marketRefreshMs:number; gameMaxStake?:number };
type AssetConfig = Record<string,string>;
type GachaReward = { id:string; name:string; item_id:number; amount:number; rarity:string; chance:number; image:string };
type GachaChest = { id:string; enabled:boolean; title:string; description:string; badge:string; icon:string; priceLocks:number; rewards:GachaReward[] };
type TradingAsset = { symbol:string; name:string; enabled:boolean; priceLocks:number; minOrder:number; maxOrder:number; logoKey:string };
type TradingConfig = { enabled:boolean; feeBps:number; minLocks:number; maxLocks:number; assets:TradingAsset[] };
const games: Game[] = [
  { id: "dice", title: "DICE", description: "Roll a number 1–100", badge: "HOT", icon: <Dice5/>, cls: "game-blue" },
  { id: "crash", title: "CRASH", description: "Timing & reaction challenge", badge: "POPULAR", icon: <Activity/>, cls: "game-purple" },
  { id: "mines", title: "MINES", description: "Find safe tiles", badge: "NEW", icon: <Shield/>, cls: "game-red" },
  { id: "roulette", title: "ROULETTE", description: "Spin the visual wheel", badge: "HOT", icon: <CircleDollarSign/>, cls: "game-crimson" },
  { id: "plinko", title: "PLINKO", description: "Drop the ball", badge: "NEW", icon: <Layers3/>, cls: "game-pink" },
  { id: "coinflip", title: "COIN FLIP", description: "Heads or tails", badge: "POPULAR", icon: <CircleDollarSign/>, cls: "game-gold" },
  { id: "tower", title: "TOWER", description: "Climb safe floors", badge: "NEW", icon: <Trophy/>, cls: "game-cyan" },
  { id: "wheel", title: "WHEEL", description: "Spin a free wheel", badge: "HOT", icon: <Sparkles/>, cls: "game-indigo" },
  { id: "hilo", title: "HI-LO", description: "Higher or lower cards", badge: "NEW", icon: <Trophy/>, cls: "game-violet" },
  { id: "memory", title: "MEMORY", description: "Match the cards", badge: "POPULAR", icon: <Boxes/>, cls: "game-teal" },
  { id: "reaction", title: "REACTION", description: "Test response time", badge: "NEW", icon: <Activity/>, cls: "game-orange" },
  { id: "luckywheel", title: "LUCKY WHEEL", description: "Free cosmetic spin", badge: "HOT", icon: <Gift/>, cls: "game-blue2" }
];

const marketSeed = [
  ["BTC/USD", "BTC", "CRYPTO"], ["ETH/USD", "ETH", "CRYPTO"], ["SOL/USD", "SOL", "CRYPTO"],
  ["LTC/USD", "LTC", "CRYPTO"], ["EUR/USD", "EUR", "FOREX"], ["GBP/USD", "GBP", "FOREX"],
  ["USD/JPY", "JPY", "FOREX"], ["XAU/USD", "XAU", "COMMODITY"], ["XAG/USD", "XAG", "COMMODITY"],
  ["SPX", "S", "INDEX"], ["NDX", "N", "INDEX"], ["AAPL", "A", "STOCK"], ["MSFT", "M", "STOCK"], ["NVDA", "N", "STOCK"]
] as const;

function formatMarketPrice(value:number, symbol:string){
  if(!Number.isFinite(value) || value===0) return "—";
  const decimals = symbol.includes("/USD") ? (value >= 1000 ? 2 : value >= 10 ? 2 : 4) : value >= 1000 ? 2 : value >= 10 ? 2 : 4;
  return value.toLocaleString(undefined,{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
}
function formatMarketChange(value:number){
  if(!Number.isFinite(value)) return "—";
  return `${value>=0?"+":""}${value.toFixed(2)}%`;
}
function marketPrefix(symbol:string){
  return ["BTC/USD","ETH/USD","SOL/USD","LTC/USD","XAU/USD","XAG/USD"].includes(symbol) ? "$" : "";
}

function CryptoLogo({symbol,assets}:{symbol:string;assets:AssetConfig}){
  const key = symbol.toLowerCase();
  const assetKey = key === "btc" ? "logo_btc" : key === "eth" ? "logo_eth" : key === "sol" ? "logo_sol" : key === "ltc" ? "logo_ltc" : key === "xau" ? "logo_xau" : key === "xag" ? "logo_xag" : key === "eur" || key === "gbp" || key === "jpy" ? "logo_forex" : key === "s" || key === "n" ? "logo_index" : key === "a" || key === "m" ? "logo_stock" : "";
  const url = assetKey ? assets[assetKey] : "";
  if(url) return <img className="asset-logo-img" src={url} alt={symbol} />;
  return <span className="asset-logo-glyph">{symbol.slice(0,3).toUpperCase()}</span>;
}

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const signal = init.signal ?? AbortSignal.timeout(15000);

  const res = await fetch(`${API_ORIGIN}${path}`, { ...init, headers, signal });
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }

  if (res.ok) return body;
  throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
}

function AuthScreen({onAuthenticated}:{onAuthenticated:(session:Session)=>void}){
  const [mode,setMode]=useState<"login"|"register">("login");
  const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [displayName,setDisplayName]=useState("");
  const [loading,setLoading]=useState(false); const [error,setError]=useState(""); const [site,setSite]=useState<SiteConfig|null>(null);
  useEffect(()=>{api("/api/config/site").then(r=>setSite(r.site||null)).catch(()=>{})},[]);
  const submit=async(e:React.FormEvent)=>{e.preventDefault(); setLoading(true); setError(""); try{
    const path=mode==="login"?"/api/auth/login":"/api/auth/register";
    const body:any={email:email.trim(),password}; if(mode==="register") body.displayName=displayName.trim();
    const r=await api(path,{method:"POST",body:JSON.stringify(body)});
    const session={token:r.session,user:r.user||{}} as Session;
    localStorage.setItem("treeps_session",JSON.stringify(session)); onAuthenticated(session);
  }catch(err){setError(err instanceof Error?err.message:"Authentication failed.")}finally{setLoading(false)}};
  return <div className="connect-page"><div className="connect-grid"/><div className="connect-orb orb-a"/><div className="connect-orb orb-b"/>
    <div className="connect-shell auth-shell">
      <div className="connect-brand"><div className="brand-mark large">T</div><div><div className="brand-name">{site?.siteName||"TREE PS"}</div><div className="brand-sub">{site?.tagline||"PRIVATE SERVER"}</div></div></div>
      <div className="connect-card auth-card">
        <div className="eyebrow"><KeyRound size={14}/> WEB ACCOUNT</div>
        <div className="connect-title"><h1>{mode==="login"?"Welcome back":"Create your account"}</h1><p>{mode==="login"?"Sign in first, then connect your GrowID using the same TREE PS /link system.":"Create a TREE PS web account. Your GrowID is still linked separately with the existing /link command."}</p></div>
        <div className="auth-switch"><button className={mode==="login"?"active":""} onClick={()=>{setMode("login");setError("")}}>LOGIN</button><button className={mode==="register"?"active":""} onClick={()=>{setMode("register");setError("")}}>REGISTER</button></div>
        <form className="auth-form" onSubmit={submit}>
          {mode==="register"&&<label>Display Name<input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your web name" maxLength={24} required/></label>}
          <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required/></label>
          <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==="register"?"Minimum 8 characters":"Your password"} autoComplete={mode==="login"?"current-password":"new-password"} minLength={8} required/></label>
          {error&&<div className="auth-error">{error}</div>}
          <button className="primary wide auth-submit" disabled={loading}>{loading?"PLEASE WAIT…":mode==="login"?"LOGIN TO TREE PS":"CREATE ACCOUNT"}</button>
        </form>
        <div className="auth-foot"><Shield size={13}/> After login/register you will continue to the existing GrowID link screen.</div>
      </div>
    </div>
  </div>;
}

function ConnectScreen({ onConnected, token, onLogout }: { onConnected: (session: Session) => void; token?: string; onLogout:()=>void }) {
  const [siteConfig, setSiteConfig] = useState<SiteConfig | null>(null);
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [status, setStatus] = useState<"creating"|"waiting"|"connected"|"expired"|"error">("creating");
  const [message, setMessage] = useState("Generating secure link code...");
  const [copied, setCopied] = useState(false);
  const [seconds, setSeconds] = useState(600);

  const createLink = async () => {
    try {
      setStatus("creating"); setMessage("Generating secure link code...");
      const result = await api("/api/auth/create-link", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      setCode(result.code); setExpiresAt(result.expiresAt); setSeconds(600); setStatus("waiting"); setMessage("Listening for your GrowID...");
    } catch (e) { setStatus("error"); setMessage(e instanceof Error ? e.message : "Backend unavailable."); }
  };
  useEffect(() => {
    let dead = false;
    api("/api/config/site").then((r) => { if(!dead && r.site) setSiteConfig(r.site); }).catch(() => {});
    return () => { dead = true; };
  }, []);
  useEffect(() => { createLink(); }, []);
  useEffect(() => {
    if (!expiresAt || status !== "waiting") return;
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSeconds(left);
      if (left === 0) { setStatus("expired"); setMessage("This link code has expired."); }
    }, 1000);
    return () => window.clearInterval(t);
  }, [expiresAt, status]);
  useEffect(() => {
    if (!code || status !== "waiting") return;
    const t = window.setInterval(async () => {
      try {
        const result: LinkStatus = await api(`/api/auth/link-status?code=${encodeURIComponent(code)}`);
        if (result.status === "connected" && result.session) {
          setStatus("connected"); setMessage("Connection successful. Redirecting...");
          const session = { token: result.session, user: result.user || {} };
          localStorage.setItem("treeps_session", JSON.stringify(session));
          window.setTimeout(() => onConnected(session), 850);
        }
        if (result.status === "expired") { setStatus("expired"); setMessage("This link code has expired."); }
      } catch {}
    }, 1200);
    return () => window.clearInterval(t);
  }, [code, status, onConnected]);

  const copy = async () => { if (!code) return; await navigator.clipboard?.writeText(`/link ${code}`); setCopied(true); setTimeout(()=>setCopied(false),1200); };
  const mm = String(Math.floor(seconds/60)).padStart(2,"0"), ss = String(seconds%60).padStart(2,"0");

  return <div className="connect-page"><div className="connect-grid"/><div className="connect-orb orb-a"/><div className="connect-orb orb-b"/>
    <div className="connect-shell">
      <div className="connect-brand"><div className="brand-mark large">T</div><div><div className="brand-name">{siteConfig?.siteName||"TREE PS"}</div><div className="brand-sub">{siteConfig?.tagline||"PRIVATE SERVER"}</div></div></div>
      <div className="connect-card">
        <div className="step-line"><div className="step active"><span>01</span><b>CONNECT</b></div><div className={`step ${status!=="creating"?"active":""}`}><span>02</span><b>VERIFY</b></div><div className={`step ${status==="connected"?"active":""}`}><span>03</span><b>COMPLETE</b></div></div>
        {status === "connected" ? <div className="success-state"><div className="success-icon"><Check size={36}/></div><div className="eyebrow"><Shield size={14}/> AUTHENTICATED</div><h1>Connection successful</h1><p>Your GrowID has been verified. Opening your TREE PS dashboard...</p></div> : <>
          <div className="connect-title"><div className="eyebrow"><Globe2 size={14}/> SECURE ACCOUNT LINK</div><h1>Connect your GrowID</h1><p>Connect your Growtopia account to continue to TREE PS. Your Growtopia password is never requested.</p></div>
          <div className="link-code-card"><div className="mini-label">YOUR ONE-TIME COMMAND</div><div className="link-command">/link {code || "TREE-XXXX-XXXX"}</div><button className="primary wide" onClick={copy}>{copied ? <><Check size={15}/> Copied</> : "Copy In-Game Command"}</button></div>
          <div className="connect-instructions"><div className="instruction"><span className="num">01</span><div><strong>Copy the command</strong><p>Use the button above to copy it.</p></div></div><div className="instruction"><span className="num">02</span><div><strong>Open Growtopia</strong><p>Enter the command in your in-game chat.</p></div></div><div className="instruction"><span className="num">03</span><div><strong>Wait for verification</strong><p>We automatically continue after the server confirms the link.</p></div></div></div>
          <div className={`connect-status ${status}`}><span className={`pulse-dot ${status==="waiting"?"pulse":""}`}/><div><strong>{status==="waiting"?"Waiting for connection...":status==="expired"?"Link expired":status==="creating"?"Preparing connection...":"Connection error"}</strong><span>{message}</span></div><div className="expiry">{status==="waiting"?`${mm}:${ss}`:""}</div></div>
          {(status==="expired"||status==="error") && <button className="secondary wide retry-btn" onClick={createLink}>Generate New Code</button>}
        </>}
      </div>
      <div className="connect-footer"><span>🔒 Secure GrowID authentication</span><span>© 2026 TREE PS</span></div><button className="secondary wide auth-logout" onClick={onLogout}>Sign out web account</button>
    </div>
  </div>;
}

function StatCard({ label, value, sub, icon }: {label:string;value:string;sub:string;icon:React.ReactNode}) {
  return <div className="stat-card"><div className="stat-icon">{icon}</div><div><div className="mini-label">{label}</div><strong>{value}</strong><span>{sub}</span></div></div>;
}

function GameRunner({ gameId, token, wallet, gameConfigs, siteConfig, onClose, onResult, onWalletChange }: { gameId:string; token:string; wallet:WalletBalance; gameConfigs:GameConfig[]; siteConfig:SiteConfig|null; onClose:()=>void; onResult:(title:string)=>void; onWalletChange:(wallet:WalletBalance)=>void }) {
  const [rolling, setRolling] = useState(false), [result, setResult] = useState<string>("—");
  const [grid, setGrid] = useState<number[]>([]); const [revealed, setRevealed] = useState<number[]>([]);
  const [coin, setCoin] = useState("—"); const [spinDeg, setSpinDeg] = useState(0);
  const [reactionStart, setReactionStart] = useState<number|null>(null), [reactionText, setReactionText] = useState("Press Start");
  const [mem, setMem] = useState<number[]>([]); const [memOpen, setMemOpen] = useState<number[]>([]);
  const gameCfg=gameConfigs.find(g=>g.id===gameId);
  const [msg, setMsg] = useState("");
  const [stake, setStake] = useState<number>(gameCfg?.stakes?.[0] || 10);
  const balanceLabel = `${Number(wallet.wl||0).toLocaleString()} WL`;

  useEffect(()=>{ if(gameId==="mines") setGrid([...Array(25)].map((_,i)=>i)); if(gameId==="memory") setMem([...Array(8)].flatMap((_,i)=>[i,i]).sort(()=>Math.random()-.5)); },[gameId]);

  const playServer = async (label:string) => {
    if(rolling) return;
    setRolling(true); setMsg("");
    try {
      const r = await api("/api/games/play", {method:"POST", headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"}, body:JSON.stringify({game_id:gameId,stake})});
      if(r.balance) onWalletChange(r.balance);
      setTimeout(()=>{
        setResult(String(r.outcome ?? "PLAYED"));
        setCoin(gameId==="coinflip" ? String(r.outcome ?? "—") : coin);
        if(gameId==="roulette") setSpinDeg(d=>d+1440);
        if(gameId.includes("wheel")) setSpinDeg(d=>d+1620);
        setMsg(`Round complete • staked ${Number(r.stake||stake).toLocaleString()} WL • payout ${Number(r.payout||0).toLocaleString()} WL`);
        setRolling(false); onResult(`${label}: ${r.outcome} • ${Number(r.payout||0).toLocaleString()} WL payout`);
      },650);
    } catch(e) { setRolling(false); setMsg(e instanceof Error?e.message:"Game request failed."); }
  };

  const action = () => playServer(gameId==="coinflip"?"Coin Flip":gameId==="roulette"?"Roulette":gameId==="wheel"||gameId==="luckywheel"?"Wheel":gameId[0].toUpperCase()+gameId.slice(1));
  const revealMine=(i:number)=>{if(revealed.includes(i)||rolling)return; setRevealed(r=>[...r,i]);};
  const startReaction=()=>{if(rolling)return; setReactionText("WAIT..."); setReactionStart(null); setTimeout(()=>{setReactionStart(performance.now());setReactionText("CLICK NOW")},700+Math.random()*1800)};
  const reactionClick=()=>{if(reactionStart){const ms=Math.round(performance.now()-reactionStart);setReactionText(`${ms} ms`);setReactionStart(null);playServer("Reaction")}else if(reactionText==="CLICK NOW")setReactionText("Too early");};
  const memClick=(i:number)=>{ if(rolling||memOpen.includes(i)) return; const next=[...memOpen,i]; setMemOpen(next); if(next.length===2){ if(mem[next[0]]===mem[next[1]]) { setTimeout(()=>setMemOpen([]),250); playServer("Memory"); } else setTimeout(()=>setMemOpen([]),500); }};
  let content:React.ReactNode;
  if(gameId==="mines") content=<div className="game-board mines-board">{grid.map(i=><button key={i} className={`mine-tile ${revealed.includes(i)?"revealed":""}`} onClick={()=>revealMine(i)}>{revealed.includes(i)?"✦":"?"}</button>)}</div>;
  else if(gameId==="memory") content=<div className="game-board memory-board">{mem.map((v,i)=><button key={i} className={`memory-tile ${memOpen.includes(i)?"open":""}`} onClick={()=>memClick(i)}>{memOpen.includes(i)?v+1:"?"}</button>)}</div>;
  else if(gameId==="reaction") content=<button className={`reaction-pad ${reactionText==="CLICK NOW"?"go":""}`} onClick={reactionText==="Press Start"?startReaction:reactionClick}>{reactionText}</button>;
  else content=<div className="game-stage"><div className={`game-big-icon ${rolling?"spin":""}`} style={{transform:(gameId==="roulette"||gameId.includes("wheel"))?`rotate(${spinDeg}deg)`:undefined}}>{gameId==="dice"?<Dice5 size={86}/>:gameId==="coinflip"?<CircleDollarSign size={86}/>:gameId==="roulette"?<CircleDollarSign size={86}/>:gameId.includes("wheel")?<Sparkles size={86}/>:gameId==="plinko"?<Layers3 size={86}/>:gameId==="crash"?<TrendingUp size={86}/>:<Trophy size={86}/>}</div><div className="game-result">{gameId==="coinflip"?coin:result}</div><button className="primary game-action" onClick={action} disabled={rolling}>{rolling?"PLAYING...":gameId==="coinflip"?"FLIP":gameId==="roulette"?"SPIN":"PLAY"}</button></div>;
  return <div className="game-modal-backdrop"><div className="game-modal"><div className="game-modal-head"><div><span className="section-kicker">GAME / SKILL SESSION</span><h2>{gameId.toUpperCase()}</h2></div><button className="icon-btn" onClick={onClose}><X size={18}/></button></div><div className="game-lockbar game-balancebar"><div><span>YOUR BALANCE</span><strong>{balanceLabel}</strong></div><div><span>STAKE</span><strong>{stake.toLocaleString()} WL</strong></div><div className="tiny">WALLET LINKED</div></div>
  <div className="game-stakes">{(gameCfg?.stakes||[10,25,50,100,250,500]).filter((v:number)=>v<=Number(gameCfg?.maxStake||siteConfig?.gameMaxStake||5000)).map((v:number)=><button key={v} className={stake===v?"active":""} onClick={()=>setStake(v)} disabled={rolling}>{v.toLocaleString()} WL</button>)}</div>{content}<div className="game-round-status"><span>{msg || `Choose a WL stake and play from your connected wallet.`}</span><b>{rolling?"LIVE":"READY"}</b></div><div className="game-modal-foot"><span><b>WALLET CONNECTED</b> • stake and payout are applied to your normal WL balance</span><button className="secondary" onClick={()=>{setResult("—");setCoin("—");setRevealed([]);setMsg("");onResult("Reset")}}><RotateCcw size={14}/> Reset</button></div></div></div>;
}

function Dashboard({ session, onLogout }: {session:Session; onLogout:()=>void}) {
  const [theme,setTheme]=useState<"dark"|"light">("dark"); const [mobileOpen,setMobileOpen]=useState(false); const [active,setActive]=useState("Dashboard"); const [search,setSearch]=useState(""); const [game,setGame]=useState<string|null>(null); const [toast,setToast]=useState("");
  const [chat,setChat]=useState(""); const [messages,setMessages]=useState([{user:"Vexor",text:"welcome to TREE PS",time:"14:20"},{user:"KenzGT",text:"market widget live",time:"14:22"}]);
  const [markets,setMarkets]=useState<MarketSummary[]>([]);
  const [gameConfigs,setGameConfigs]=useState<GameConfig[]>([]);
  const [assets,setAssets]=useState<AssetConfig>({});
  const [siteConfig,setSiteConfig]=useState<SiteConfig|null>(null);
  const [wallet,setWallet]=useState<WalletBalance>({wl:0,dl:0,bgl:0,ggl:0,gems:0});
  const displayName=session.user.clean_name||session.user.growid||"PLAYER";
  const admin=session.user.is_admin===true;
  const baseNav: Array<[string, React.ReactNode]> = [["Dashboard",<LayoutDashboard/>],["Game Hub",<Gamepad2/>],["Balance Trading",<BarChart3/>],["Gacha Vault",<Gift/>],["Wallet",<Wallet/>],["Inventory",<Boxes/>],["Global Chat",<MessageCircle/>],["History",<Activity/>],["Profile",<UserRound/>],["Settings",<Settings/>]];
  const nav: Array<[string, React.ReactNode]> = admin ? [...baseNav,["Admin Panel",<ShieldCheck/>]] : baseNav;
  const visibleGames=useMemo(()=>{const configured=gameConfigs.length?gameConfigs:games.map(g=>({...g,icon:undefined} as any)); const merged=games.map(base=>{const c=configured.find((x:any)=>x.id===base.id); return c?{...base,title:c.title,description:c.description,badge:c.badge,enabled:c.enabled}:base}).filter((g:any)=>g.enabled!==false); const q=search.toLowerCase().trim();return q?merged.filter((g:any)=>(g.title+g.description).toLowerCase().includes(q)):merged},[search,gameConfigs]);
  useEffect(()=>{let dead=false; const load=async()=>{try{const r=await api("/api/games/config"); if(!dead){setGameConfigs(r.games||[]);setSiteConfig(r.site||null)}}catch{}}; load(); return()=>{dead=true}},[]);
  useEffect(()=>{let dead=false; const load=async()=>{try{const r=await api("/api/config/assets");if(!dead)setAssets(r.assets||{})}catch{}}; load(); return()=>{dead=true}},[]);
  useEffect(()=>{
    let dead=false;
    const load=async()=>{
      try{
        const r=await api("/api/markets");
        if(!dead&&Array.isArray(r.markets)) setMarkets(r.markets);
      }catch{}
    };
    load();
    const t=setInterval(load,siteConfig?.marketRefreshMs||5000);
    return()=>{dead=true;clearInterval(t)};
  },[]);
  const refreshWallet=async()=>{try{const r=await api("/api/player/wallet",{headers:{Authorization:`Bearer ${session.token}`}});if(r.wallet)setWallet(r.wallet);return r.wallet}catch{return null}};
  useEffect(()=>{let dead=false; const load=async()=>{try{const r=await api("/api/player/wallet",{headers:{Authorization:`Bearer ${session.token}`}}); if(!dead&&r.wallet)setWallet(r.wallet)}catch{}}; load(); const t=setInterval(load,2500); return()=>{dead=true;clearInterval(t)}},[session.token]);
  const show=(s:string)=>{setToast(s);setTimeout(()=>setToast(""),1600)};
  const content=()=>{
    if(active==="Dashboard") return <>
      <div className="hero-grid"><div className="hero-card"><div className="hero-copy"><div className="eyebrow"><Shield size={14}/> GROWID VERIFIED PLATFORM</div><h1>Build your next<br/><span>move here.</span></h1><p>One verified GrowID connects your TREE PS account to your internal wallet, games, collection vault, and market reference data.</p><div className="hero-pills"><span><Globe2 size={13}/>{displayName}</span><span><BarChart3 size={13}/> Live Rates</span><span><Sparkles size={13}/> Instant Access</span></div><div className="hero-buttons"><button className="primary" onClick={()=>setActive("Game Hub")}>Explore Games <ChevronRight size={17}/></button><button className="secondary" onClick={()=>setActive("Balance Trading")}>Open Markets</button></div></div><div className="hero-art"><div className="hero-glow"/><div className="terminal-window"><div className="terminal-head"><span>SECURE SESSION</span><span className="live-badge">CONNECTED</span></div><div className="terminal-title">{displayName}</div><div className="terminal-text">Your GrowID session is verified and ready.</div><div className="codebox">UID {session.user.user_id??"—"}</div><button className="outline wide" onClick={onLogout}>Disconnect Web Account</button><div className="auth-status"><span className="dot green"/>GrowID verified • session connected</div></div></div></div><div className="balance-card"><div className="card-top"><span className="mini-label">AVAILABLE BALANCE</span><span className="balance-tag">IN-GAME</span></div><div className="balance-main">{wallet.wl} <small>WL</small></div><div className="balance-row"><span>Reserved</span><strong>0 DL</strong></div><div className="balance-row"><span>Status</span><strong className="green-text">ACTIVE</strong></div><div className="command-box"><span>/deposit 10 wl</span><button className="tiny" onClick={()=>navigator.clipboard?.writeText("/deposit 10 wl")}>Copy</button></div><button className="outline wide" onClick={()=>setActive("Wallet")}>Deposit / Withdraw ↗</button></div></div>
      <div className="stats-grid"><StatCard label="WL BALANCE" value={`${wallet.wl} WL`} sub="In-game" icon={<Wallet size={16}/>} /><StatCard label="DL BALANCE" value={`${wallet.dl} DL`} sub="Internal" icon={<CircleDollarSign size={16}/>} /><StatCard label="BGL BALANCE" value={`${wallet.bgl} BGL`} sub="Internal" icon={<CircleDollarSign size={16}/>} /><StatCard label="GGL BALANCE" value={`${wallet.ggl} GGL`} sub="Internal" icon={<CircleDollarSign size={16}/>} /></div>
      <SectionHead title="Top Markets" kicker="CHANNEL 01 / MARKET" action="All Markets →" onClick={()=>setActive("Balance Trading")}/>
      <div className="market-table panel">{marketSeed.slice(0,8).map(([sym,base,cat])=>{const q=markets.find(m=>m.symbol===sym);return <div className="market-row" key={sym}><div className="market-icon"><CryptoLogo symbol={base} assets={assets}/></div><div className="market-name"><strong>{sym}</strong><span>{cat}</span></div><div className="market-price"><strong>{q?`${marketPrefix(sym)}${formatMarketPrice(q.price,sym)}`:"—"}</strong><span className={q&&q.changePercent>=0?"up":"down"}>{q?formatMarketChange(q.changePercent):"Waiting..."}</span></div></div>})}</div>
    </>;
    if(active==="Game Hub") return <><PageHero kicker="GAME CENTER / SKILL SESSIONS" title="Game Hub" text="Every game uses your normal TREE PS WL wallet. Stakes are deducted server-side and payouts are returned to the same wallet instantly."/><div className="game-wallet-panel game-balance-panel panel"><div><div className="mini-label">YOUR BALANCE</div><strong>{wallet.wl.toLocaleString()} WL</strong><span>Normal wallet balance</span></div><div className="tiny-note">No separate game credit balance</div></div><div className="section-head"><div/><div className="tabs"><button className="active">All</button><button>Popular</button><button>New</button><button>Originals</button></div></div><div className="game-grid">{visibleGames.map(g=><button className={`game-card ${g.cls}`} key={g.id} onClick={()=>setGame(g.id)}><div className="game-badge-row"><span className="status-badge"><span className="dot"/> ONLINE</span><span className="hot-badge">{g.badge}</span></div><div className="game-art">{assets[`game_${g.id}`]?<img src={assets[`game_${g.id}`]} alt=""/>:g.icon}</div><div className="game-name">{g.title}</div><div className="game-footer"><div><strong>{g.title}</strong><span>{g.description}</span></div><span className="play">PLAY</span></div></button>)}</div></>;
    if(active==="Balance Trading") return <TradingPage token={session.token} markets={markets} assets={assets} wallet={wallet} onAction={show} onWalletChange={setWallet}/>;
    if(active==="Gacha Vault") return <GachaPage session={session} wallet={wallet} onAction={show} onWalletChange={setWallet}/>;
    if(active==="Wallet") return <WalletPage token={session.token} wallet={wallet} onRefresh={async()=>{try{const r=await api("/api/player/wallet",{headers:{Authorization:`Bearer ${session.token}`}});if(r.wallet)setWallet(r.wallet)}catch{}}}/>;
    if(active==="Inventory") return <InventoryPage wallet={wallet}/>;
    if(active==="Global Chat") return <ChatPage messages={messages} chat={chat} setChat={setChat} send={()=>{if(chat.trim()){setMessages(m=>[...m,{user:displayName,text:chat.trim(),time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}]);setChat("")}}}/>;
    if(active==="History") return <HistoryPage/>;
    if(active==="Admin Panel" && admin) return <AdminPage token={session.token} onAction={show}/>;
    if(active==="Profile") return <ProfilePage user={session.user}/>;
    return <SettingsPage theme={theme} setTheme={setTheme} onLogout={onLogout}/>;
  };
  return <div className={`app ${theme}`} style={{"--primary":siteConfig?.accent||"#5f5bf6"} as React.CSSProperties}><aside className={`sidebar ${mobileOpen?"open":""}`}><div className="brand"><div className="brand-mark">T</div><div><div className="brand-name">TREE PS</div><div className="brand-sub">PRIVATE SERVER</div></div><button className="icon-btn mobile-only" onClick={()=>setMobileOpen(false)}><X size={18}/></button></div><div className="sidebar-label">MAIN</div>{nav.slice(0,2).map(([l,i])=><NavBtn key={l} label={l} icon={i} active={active} setActive={(x)=>{setActive(x);setMobileOpen(false)}}/>)}<div className="sidebar-label">SERVICES</div>{nav.slice(2,7).map(([l,i])=><NavBtn key={l} label={l} icon={i} active={active} setActive={(x)=>{setActive(x);setMobileOpen(false)}}/>)}<div className="sidebar-label">ACCOUNT</div>{nav.slice(7,10).map(([l,i]:any)=><NavBtn key={l} label={l} icon={i} active={active} setActive={(x)=>{setActive(x);setMobileOpen(false)}}/>)}{admin&&<><div className="sidebar-label">CONTROL</div>{nav.slice(10).map(([l,i]:any)=><NavBtn key={l} label={l} icon={i} active={active} setActive={(x)=>{setActive(x);setMobileOpen(false)}}/>)}</>}<div className="sidebar-spacer"/><div className="online-pill"><span className="dot"/>1,423 players online</div><button className="profile-mini" onClick={()=>setActive("Profile")}><div className="avatar">{displayName[0]?.toUpperCase()||"P"}</div><div className="profile-meta"><strong>{displayName}</strong><span className="online-text">● Connected</span></div><ChevronRight size={16}/></button></aside><main className="main"><header className="topbar"><button className="icon-btn mobile-only" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><div className="page-title"><span>Trading.</span><b>{active}</b></div><div className="top-actions"><div className="searchbox"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari game, asset, item..."/></div><div className="wallet-chip"><Wallet size={14}/>{wallet.wl} WL</div><div className="wallet-chip">{wallet.dl} DL</div>{admin&&<button className="admin-quick-btn" onClick={()=>setActive("Admin Panel")}><ShieldCheck size={14}/> ADMIN PANEL</button>}<div className="theme-toggle"><button className={theme==="light"?"on":""} onClick={()=>setTheme("light")}><Sun size={13}/></button><button className={theme==="dark"?"on":""} onClick={()=>setTheme("dark")}><Moon size={13}/></button></div><button className="icon-btn"><Bell size={16}/></button></div></header><div className="ticker">{marketSeed.slice(0,8).map(([sym,base,cat])=>{const q=markets.find(m=>m.symbol===sym);return <div className="ticker-item" key={sym}><span className="ticker-dot"/><CryptoLogo symbol={base} assets={assets}/><strong>{sym}</strong><span className="ticker-price">{q?formatMarketPrice(q.price,sym):"—"}</span><span className={q&&q.changePercent>=0?"up":"down"}>{q?formatMarketChange(q.changePercent):"—"}</span><span className="ticker-cat">{cat}</span></div>})}</div><section className="content">{content()}<footer className="footer"><span>© 2026 {siteConfig?.siteName||"TREE PS"}</span><span>GrowID {displayName} • Internal GTPS economy</span></footer></section></main>{game&&<GameRunner gameId={game} token={session.token} wallet={wallet} gameConfigs={gameConfigs} siteConfig={siteConfig} onClose={()=>setGame(null)} onResult={show} onWalletChange={setWallet}/>} {toast&&<div className="toast">✓ {toast}</div>}</div>;
}

function NavBtn({label,icon,active,setActive}:{label:string;icon:React.ReactNode;active:string;setActive:(s:string)=>void}){return <button className={`nav-item ${active===label?"active":""}`} onClick={()=>setActive(label)}>{icon}<span>{label}</span></button>}
function SectionHead({title,kicker,action,onClick}:{title:string;kicker:string;action:string;onClick:()=>void}){return <div className="section-head"><div><div className="section-kicker">{kicker}</div><h2>{title}</h2></div><button className="link-btn" onClick={onClick}>{action}</button></div>}
function PageHero({kicker,title,text}:{kicker:string;title:string;text:string}){return <div className="page-hero"><div className="section-kicker">{kicker}</div><h1>{title}</h1><p>{text}</p></div>}
function LivePriceChart({points}:{points:MarketPoint[]}){
  const clean=points.filter(p=>Number.isFinite(p.price));
  if(clean.length<2) return <div className="live-chart-empty">Waiting for market candles…</div>;
  const min=Math.min(...clean.map(p=>p.price));
  const max=Math.max(...clean.map(p=>p.price));
  const range=Math.max(max-min,Math.abs(max)*0.000001,1e-9);
  const coords=clean.map((p,i)=>`${(i/(clean.length-1))*100},${95-((p.price-min)/range)*85}`).join(" ");
  const last=clean[clean.length-1];
  const lastX=100,lastY=95-((last.price-min)/range)*85;
  return <svg className="live-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Live market price chart">
    {[10,30,50,70,90].map(y=><line key={y} x1="0" y1={y} x2="100" y2={y} className="chart-grid-line"/>)}
    <polyline points={coords} className="chart-live-line" fill="none"/>
    <circle cx={lastX} cy={lastY} r="1.7" className="chart-live-dot"/>
  </svg>;
}

function TradingPage({token,markets,assets,wallet,onAction,onWalletChange}:{token:string;markets:MarketSummary[];assets:AssetConfig;wallet:WalletBalance;onAction:(s:string)=>void;onWalletChange:(wallet:WalletBalance)=>void}){
  const [selected,setSelected]=useState("BTC/USD");
  const [detail,setDetail]=useState<MarketDetail|null>(null);
  const [loading,setLoading]=useState(true);
  const [trade,setTrade]=useState<TradingConfig|null>(null);
  const [portfolio,setPortfolio]=useState<Record<string,number>>({});
  const [balance,setBalance]=useState(wallet.wl);
  const [side,setSide]=useState<"BUY"|"SELL">("BUY");
  const [amount,setAmount]=useState("0.001");
  const [tradingBusy,setTradingBusy]=useState(false);
  const selectedSummary=markets.find(m=>m.symbol===selected);
  const tabs=["BTC/USD","ETH/USD","SOL/USD","LTC/USD","EUR/USD","GBP/USD","USD/JPY","XAU/USD","XAG/USD","SPX","NDX","AAPL","MSFT","NVDA"];
  useEffect(()=>{
    let dead=false;
    const load=async()=>{
      try{
        setLoading(true);
        const r=await api(`/api/markets/${encodeURIComponent(selected)}`);
        if(!dead&&r.market) setDetail(r.market);
      }catch{ if(!dead) setDetail(null); }
      finally{ if(!dead) setLoading(false); }
    };
    load(); const t=setInterval(load,5000); return()=>{dead=true;clearInterval(t)};
  },[selected]);
  useEffect(()=>{
    let dead=false;
    const load=async()=>{if(!token)return;try{const [c,p]=await Promise.all([api('/api/trading/config',{headers:{Authorization:`Bearer ${token}`}}),api('/api/trading/portfolio',{headers:{Authorization:`Bearer ${token}`}})]);if(!dead){setTrade(c.trading||null);setPortfolio(p.holdings||{});setBalance(p.wallet?.wl ?? wallet.wl)}}catch{}};
    load(); const t=setInterval(load,2500); return()=>{dead=true;clearInterval(t)};
  },[token]);
  const q=detail||selectedSummary;
  const assetSymbol=selected.split("/")[0];
  const asset=trade?.assets?.find(a=>a.symbol===assetSymbol);
  useEffect(()=>{ if(asset && Number(amount)<asset.minOrder) setAmount(String(asset.minOrder)); },[asset?.symbol]);
  const execute=async()=>{
    if(!asset||!token||tradingBusy)return;
    const n=Number(amount); if(!Number.isFinite(n)||n<=0){onAction('Invalid trade amount');return;}
    setTradingBusy(true);
    try{
      const r=await api('/api/trading/order',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({symbol:asset.symbol,side,amount:n})});
      setPortfolio(r.holdings||{}); setBalance(r.wallet?.wl ?? balance); if(r.wallet) onWalletChange(r.wallet);
      onAction(`${side} ${n} ${asset.symbol} • ${r.order?.grossBalance||0} WL`);
    }catch(e){onAction(e instanceof Error?e.message:'Trade failed')}
    finally{setTradingBusy(false)}
  };
  const held=Number(portfolio[assetSymbol]||0);
  return <><PageHero kicker="CHANNEL 01 / VIRTUAL BALANCE MARKET" title="Balance Trading" text="Trade supported virtual assets using your normal TREE PS wallet balance. Live market prices remain reference data."/>
    <div className="trading-shell">
      <aside className="trade-side">
        <button className="trade-tab active"><LayoutDashboard size={14}/>Overview</button>
        <button className="trade-tab"><TrendingUp size={14}/>Live Feed</button>
        <button className="trade-tab"><CircleDollarSign size={14}/>Quotes</button>
        <button className="trade-tab"><Boxes size={14}/>Holdings</button>
        <button className="trade-tab"><Activity size={14}/>History</button>
      </aside>
      <div className="trade-main">
        <div className="asset-header">
          <div><span className="status-badge">● {q?.status||"SYNCING"}</span><div className="asset-title-line"><CryptoLogo symbol={assetSymbol} assets={assets}/><h2>{selected}</h2></div><span>{q?.provider||"Loading market provider…"}</span></div>
          <div className="asset-price"><strong>{q&&q.price?`${marketPrefix(selected)}${formatMarketPrice(q.price,selected)}`:"—"}</strong><span className={q&&q.changePercent>=0?"up":"down"}>{q?formatMarketChange(q.changePercent):"—"}</span></div>
        </div>
        <div className="asset-tabs">{tabs.map(a=><button key={a} className={selected===a?"active":""} onClick={()=>setSelected(a)}>{a}</button>)}</div>
        <div className="chart-card"><div className="chart-head"><div><span>Live Price Chart</span><small>{detail?.points?.length||0} points • refreshed every 5s</small></div><div className="chart-intervals"><b>1m</b><span>5m</span><span>15m</span><span>1h</span><span>4h</span><span>1D</span></div></div><div className="real-chart"><LivePriceChart points={detail?.points||[]} />{loading&&<div className="chart-loading">SYNCING FEED…</div>}</div></div>
        <div className="market-metrics panel"><div><span>24H HIGH</span><strong>{q?.high?formatMarketPrice(q.high,selected):"—"}</strong></div><div><span>24H LOW</span><strong>{q?.low?formatMarketPrice(q.low,selected):"—"}</strong></div><div><span>VOLUME</span><strong>{q?.volume?Number(q.volume).toLocaleString(undefined,{maximumFractionDigits:2}):"—"}</strong></div><div><span>LAST SYNC</span><strong>{q?.timestamp?new Date(q.timestamp).toLocaleTimeString():"—"}</strong></div></div>
        <div className="order-book panel"><div className="panel-head"><h3>Virtual Order Tape</h3><span className="online-now">● BALANCE MARKET</span></div><div className="quote-row"><span>Asset</span><strong>{asset?.name||assetSymbol}</strong></div><div className="quote-row"><span>Virtual price</span><strong>{asset?`${asset.priceLocks.toLocaleString()} WL / ${asset.symbol}`:"Trading disabled for this symbol"}</strong></div><div className="quote-row"><span>Your holdings</span><strong>{held.toFixed(6)} {assetSymbol}</strong></div><div className="quote-row"><span>Wallet</span><strong>{balance.toLocaleString()} WL</strong></div></div>
      </div>
      <aside className="trade-order panel"><div className="mini-label">BALANCE TRADING</div><h3>{asset?.name||assetSymbol}</h3><div className="trade-balance"><span>AVAILABLE</span><b>{balance.toLocaleString()} WL</b></div><div className="trade-toggle"><button className={side==="BUY"?"active buy":""} onClick={()=>setSide("BUY")}>BUY</button><button className={side==="SELL"?"active sell":""} onClick={()=>setSide("SELL")}>SELL</button></div><label className="trade-label">Amount ({assetSymbol})<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" placeholder={asset?String(asset.minOrder):"0.001"}/></label><div className="trade-preview"><div><span>Virtual unit price</span><b>{asset?`${asset.priceLocks.toLocaleString()} WL`:"—"}</b></div><div><span>Estimated total</span><b>{asset&&Number(amount)>0?`${Math.round(Number(amount)*asset.priceLocks).toLocaleString()} WL`:`—`}</b></div><div><span>Fee</span><b>0 WL</b></div></div><button className="primary wide" disabled={!asset||!trade?.enabled||tradingBusy} onClick={execute}>{tradingBusy?"PROCESSING…":`${side} ${assetSymbol}`}</button><p className="tiny-note">Trades use your normal WL wallet balance for this virtual market. Assets remain virtual holdings.</p><div className="holdings-box"><div className="mini-label">YOUR HOLDINGS</div>{(trade?.assets||[]).map(a=><div className="holding-row" key={a.symbol}><span>{a.symbol}</span><b>{Number(portfolio[a.symbol]||0).toFixed(6)}</b></div>)}</div></aside>
    </div>
  </>;
}

function GachaPage({session,wallet,onAction,onWalletChange}:{session:Session;wallet:WalletBalance;onAction:(s:string)=>void;onWalletChange:(wallet:WalletBalance)=>void}){
  const [chests,setChests]=useState<GachaChest[]>([]);
  const [pending,setPending]=useState<any[]>([]);
  const [history,setHistory]=useState<any[]>([]);
  const [balance,setBalance]=useState(wallet.wl);
  const [selected,setSelected]=useState<string>('');
  const [count,setCount]=useState(1);
  const [rolling,setRolling]=useState(false);
  const [reveal,setReveal]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const auth={headers:{Authorization:`Bearer ${session.token}`}};
  const load=async()=>{try{
    const [c,p,w,h]=await Promise.all([
      api('/api/gacha/config',auth),api('/api/gacha/pending',auth),api('/api/player/wallet',auth),api('/api/player/gacha-history',auth)
    ]);
    setChests(c.chests||[]); setPending(p.rewards||[]); setBalance(w.wallet?.wl ?? wallet.wl); if(w.wallet) onWalletChange(w.wallet); setHistory(h.items||[]);
    if(!selected && c.chests?.length) setSelected(c.chests[0].id);
  }catch(e){onAction(e instanceof Error?e.message:'Gacha unavailable')}finally{setLoading(false)}};
  useEffect(()=>{load();const t=setInterval(load,3000);return()=>clearInterval(t)},[session.token]);
  const chest=chests.find(c=>c.id===selected)||chests[0];
  const spin=async()=>{
    if(!chest||rolling)return;
    setRolling(true); setReveal([]);
    try{
      const r=await api('/api/gacha/spin',{method:'POST',headers:{...auth.headers,'Content-Type':'application/json'},body:JSON.stringify({chest_id:chest.id,count})});
      setBalance(wallet.wl);
      await new Promise(res=>setTimeout(res,650));
      setReveal(r.rewards||[]); setPending(p=>[...p,...(r.rewards||[])]); setHistory(h=>[{chestTitle:chest.title,entryBalance:r.cost,rewards:r.rewards,at:Date.now()},...h]);
      onAction(`${count}x ${chest.title} opened`);
    }catch(e){onAction(e instanceof Error?e.message:'Gacha spin failed')}
    finally{setRolling(false)}
  };
  return <><PageHero kicker="CHANNEL 02 / GACHA VAULT" title="Gacha Vault" text="Open configurable chests using the same WL wallet as Game Hub and Trading. Rewards are queued for your connected GrowID."/>
    <div className="gacha-topbar panel"><div><div className="mini-label">YOUR BALANCE</div><strong>{balance.toLocaleString()} WL</strong><span>Normal wallet balance</span></div><div className="gacha-cost"><span>SELECTED ENTRY</span><b>{chest?.priceLocks||0} WL</b></div><div className="gacha-actions"><button className={count===1?'active':''} onClick={()=>setCount(1)}>1X</button><button className={count===10?'active':''} onClick={()=>setCount(10)}>10X</button></div></div>
    <div className="gacha-layout"><div><div className="gacha-chest-grid">{chests.map(c=><button className={`gacha-chest ${selected===c.id?'selected':''}`} key={c.id} onClick={()=>{setSelected(c.id);setReveal([])}}><div className="gacha-chest-art">{c.icon?<img src={c.icon} alt=""/>:<Gift size={38}/>}</div><div className="gacha-badge">{c.badge}</div><h3>{c.title}</h3><p>{c.description}</p><div className="gacha-entry">{c.priceLocks||0} WL / OPEN</div></button>)}</div>
      {chest&&<div className="gacha-open panel"><div className="gacha-open-head"><div><div className="mini-label">SELECTED CHEST</div><h2>{chest.title}</h2><span>{chest.description}</span></div><div className="gacha-open-icon">{chest.icon?<img src={chest.icon} alt=""/>:<Gift size={44}/>}</div></div><div className={`gacha-reveal ${rolling?'rolling':''}`}>{rolling?<div className="gacha-roll-state"><Sparkles size={28}/><strong>OPENING CHEST…</strong><span>Server is resolving your rewards.</span></div>:reveal.length?<div className="gacha-reward-grid">{reveal.map((r,i)=><div className={`gacha-reward rarity-${String(r.rarity||'common').toLowerCase()}`} key={i}>{r.image?<img src={r.image} alt=""/>:<div className="reward-glyph">{String(r.item_id||'?')[0]}</div>}<strong>{r.name||`Item ${r.item_id}`}</strong><span>{r.rarity||'COMMON'} • x{r.amount}</span></div>)}</div>:<div className="gacha-roll-state"><Gift size={28}/><strong>Ready to open</strong><span>Open {count} reward{count>1?"s":""}. Cost is {((chest?.priceLocks||0)*count).toLocaleString()} WL from your wallet.</span></div>}</div><button className="primary wide gacha-open-btn" disabled={rolling} onClick={spin}>{rolling?'OPENING…':`OPEN ${count}X • ${((chest?.priceLocks||0)*count).toLocaleString()} WL`}</button></div>}
    </div><aside><div className="gacha-side panel"><div className="mini-label">PENDING REWARDS</div><h2>{pending.length}</h2><div className="claim-command"><span>/claimgacha</span><button className="tiny" onClick={()=>navigator.clipboard?.writeText('/claimgacha')}>Copy</button></div><p>Rewards from web Gacha are delivered to the connected GrowID through the in-game <b>/claimgacha</b> command.</p></div><div className="gacha-side panel"><div className="mini-label">RECENT OPENINGS</div>{history.slice(0,6).length===0?<span className="tiny-note">No Gacha history yet.</span>:history.slice(0,6).map((h:any,i:number)=><div className="gacha-history-row" key={i}><div><strong>{h.chestTitle||'Gacha'}</strong><span>{Number(h.entryBalance||0).toLocaleString()} WL</span></div><b>{h.rewards?.length||0}x</b></div>)}</div></aside></div></>;
}

function WalletPage({token,wallet,onRefresh}:{token:string;wallet:WalletBalance;onRefresh:()=>void}){const [copied,setCopied]=useState('');const copy=(cmd:string)=>{navigator.clipboard?.writeText(cmd);setCopied(cmd);setTimeout(()=>setCopied(''),1200)};return <><PageHero kicker="INTERNAL ECONOMY" title="Wallet" text="Your TREE PS web ledger starts at zero. Deposit and withdraw only from inside Growtopia."/><div className="wallet-grid"><div className="wallet-big panel"><div className="mini-label">TOTAL INTERNAL BALANCE</div><strong>{wallet.wl} WL</strong><span>Primary web ledger balance</span><div className="wallet-breakdown"><div><b>{wallet.wl}</b><span>WL</span></div><div><b>{wallet.dl}</b><span>DL</span></div><div><b>{wallet.bgl}</b><span>BGL</span></div><div><b>{wallet.ggl}</b><span>GGL</span></div></div><button className="secondary" onClick={onRefresh}>Refresh Balance</button></div><div className="wallet-action panel"><div className="mini-label">DEPOSIT FROM GAME</div><h3>/deposit</h3><p>Remove locks from your in-game inventory and credit the same amount to your TREE PS web ledger.</p><div className="wallet-command">/deposit 100 wl <button className="tiny" onClick={()=>copy('/deposit 100 wl')}>{copied==='/deposit 100 wl'?'Copied':'Copy'}</button></div><div className="wallet-command">/deposit 1 dl <button className="tiny" onClick={()=>copy('/deposit 1 dl')}>{copied==='/deposit 1 dl'?'Copied':'Copy'}</button></div><span className="tiny-note">Supported: WL, DL, BGL, GGL</span></div><div className="wallet-action panel"><div className="mini-label">WITHDRAW TO GAME</div><h3>/withdraw</h3><p>Transfer web-ledger balance back into the connected Growtopia account.</p><div className="wallet-command">/withdraw 100 wl <button className="tiny" onClick={()=>copy('/withdraw 100 wl')}>{copied==='/withdraw 100 wl'?'Copied':'Copy'}</button></div><div className="wallet-command">/withdraw 1 dl <button className="tiny" onClick={()=>copy('/withdraw 1 dl')}>{copied==='/withdraw 1 dl'?'Copied':'Copy'}</button></div><span className="tiny-note">Insufficient balance is rejected by the backend.</span></div><div className="wallet-action panel"><div className="mini-label">GACHA CLAIM</div><h3>/claimgacha</h3><p>Collect pending rewards earned through the TREE PS Gacha Vault.</p><div className="wallet-command">/claimgacha <button className="tiny" onClick={()=>copy('/claimgacha')}>{copied==='/claimgacha'?'Copied':'Copy'}</button></div><span className="tiny-note">Rewards are claimed in-game, not auto-added to the website.</span></div></div></>}

function InventoryPage({wallet}:{wallet:WalletBalance}){const items=[['WL',wallet.wl],['DL',wallet.dl],['BGL',wallet.bgl],['GGL',wallet.ggl],['Gems',wallet.gems],['Magic Item',3],['Rare Block',18],['Potion',7],['Ticket',12]];return <><PageHero kicker="COLLECTION" title="Inventory" text="Your TREE PS internal items and balances."/><div className="inventory-grid">{items.map(([n,c])=><div className="inventory-item" key={String(n)}><div className="item-art">{String(n)[0]}</div><div><strong>{n}</strong><span>Quantity</span></div><b>{c}</b></div>)}</div></>}
function ChatPage({messages,chat,setChat,send}:{messages:{user:string;text:string;time:string}[];chat:string;setChat:(s:string)=>void;send:()=>void}){return <><PageHero kicker="CHANNEL 03 / COMMUNITY" title="Global Chat" text="Realtime community chat for your TREE PS server."/><div className="chat-panel panel"><div className="panel-head"><h3>GLOBAL CHAT</h3><span className="online-now">● 313 ONLINE</span></div><div className="chat-list tall">{messages.map((m,i)=><div className="chat-msg" key={i}><div className="avatar small">{m.user[0]}</div><div><strong>{m.user}</strong><p>{m.text}</p></div><time>{m.time}</time></div>)}</div><div className="chat-input"><input value={chat} onChange={e=>setChat(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Kirim pesan di chat..."/><button onClick={send}><Send size={14}/> Kirim</button></div></div></>}
function HistoryPage(){const rows=[['Gacha','Legendary Crate','+1','Today 14:20'],['Game','DICE','Result 72','Today 13:14'],['Trading','BTC/USD','Buy 25 WL','Yesterday'],['Inventory','WL','+50','Yesterday']];return <><PageHero kicker="ACCOUNT" title="History" text="Unified activity history across TREE PS."/><div className="history-table panel">{rows.map((r,i)=><div className="history-row" key={i}><div className="history-icon"><Activity size={15}/></div><div><strong>{r[0]}</strong><span>{r[1]}</span></div><b>{r[2]}</b><time>{r[3]}</time></div>)}</div></>}
function ProfilePage({user}:{user:User}){return <><PageHero kicker="ACCOUNT" title="Profile" text="Your connected GrowID and TREE PS session."/><div className="profile-card panel"><div className="profile-big"><div className="avatar xl">{(user.clean_name||user.growid||'P')[0]}</div><div><div className="section-kicker">GROWID</div><h2>{user.clean_name||user.growid||'PLAYER'}</h2><span>● Connected</span></div></div><div className="profile-details"><div><span>User ID</span><strong>{user.user_id??'—'}</strong></div><div><span>Server</span><strong>{user.server||'TREE PS'}</strong></div><div><span>Status</span><strong className="green-text">Verified</strong></div></div></div></>}
function AdminPage({token,onAction}:{token:string;onAction:(s:string)=>void}){
  const [state,setState]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState("overview");
  const [busy,setBusy]=useState(false);
  const [newAdminEmail,setNewAdminEmail]=useState("");

  const load=async()=>{
    try{
      setLoading(true);
      const r=await api("/api/admin/state",{headers:{Authorization:`Bearer ${token}`}});
      setState(r);
    }catch(e){ onAction(e instanceof Error?e.message:"Admin access required"); }
    finally{ setLoading(false); }
  };
  useEffect(()=>{load()},[]);

  const setSiteField=(key:string,value:any)=>setState((x:any)=>({...x,site:{...x.site,[key]:value}}));
  const setGameField=(id:string,key:string,value:any)=>setState((x:any)=>({...x,games:x.games.map((g:any)=>g.id===id?{...g,[key]:value}:g)}));
  const setGachaField=(id:string,key:string,value:any)=>setState((x:any)=>({...x,gacha:x.gacha.map((g:any)=>g.id===id?{...g,[key]:value}:g)}));
  const setGachaRewardField=(id:string,index:number,key:string,value:any)=>setState((x:any)=>({...x,gacha:x.gacha.map((g:any)=>g.id===id?{...g,rewards:g.rewards.map((r:any,i:number)=>i===index?{...r,[key]:value}:r)}:g)}));
  const addGachaReward=(id:string)=>setState((x:any)=>({...x,gacha:x.gacha.map((g:any)=>g.id===id?{...g,rewards:[...g.rewards,{id:`${id}-${g.rewards.length+1}`,name:'New Reward',item_id:242,amount:1,rarity:'COMMON',chance:1,image:''}]}:g)}));
  const removeGachaReward=(id:string,index:number)=>setState((x:any)=>({...x,gacha:x.gacha.map((g:any)=>g.id===id?{...g,rewards:g.rewards.filter((_:any,i:number)=>i!==index)}:g)}));
  const saveGacha=async(g:any)=>{setBusy(true);try{const r=await api(`/api/admin/gacha/${g.id}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(g)});setState((x:any)=>({...x,gacha:x.gacha.map((c:any)=>c.id===g.id?r.gacha:c)}));onAction(`${g.title} gacha saved`)}catch(e){onAction(e instanceof Error?e.message:'Gacha save failed')}finally{setBusy(false)}};

  const saveSite=async()=>{
    if(!state)return;
    setBusy(true);
    try{
      const r=await api("/api/admin/settings",{method:"PUT",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({site:state.site})});
      setState((x:any)=>({...x,site:r.site}));
      onAction("Site settings saved");
    }catch(e){onAction(e instanceof Error?e.message:"Save failed")}finally{setBusy(false)}
  };
  const saveGame=async(gameCfg:any)=>{
    setBusy(true);
    try{
      const r=await api(`/api/admin/games/${gameCfg.id}`,{method:"PUT",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(gameCfg)});
      setState((x:any)=>({...x,games:x.games.map((g:any)=>g.id===gameCfg.id?r.game:g)}));
      onAction(`${gameCfg.title} updated`);
    }catch(e){onAction(e instanceof Error?e.message:"Game save failed")}finally{setBusy(false)}
  };
  const saveTrading=async()=>{if(!state?.trading)return;setBusy(true);try{const r=await api("/api/admin/trading/settings",{method:"PUT",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({enabled:state.trading.enabled,feeBps:state.trading.feeBps,minLocks:state.trading.minLocks,maxLocks:state.trading.maxLocks})});setState((x:any)=>({...x,trading:r.trading}));onAction("Trading settings saved")}catch(e){onAction(e instanceof Error?e.message:"Trading save failed")}finally{setBusy(false)}};
  const setTradingField=(key:string,value:any)=>setState((x:any)=>({...x,trading:{...x.trading,[key]:value}}));
  const setTradingAssetField=(symbol:string,key:string,value:any)=>setState((x:any)=>({...x,trading:{...x.trading,assets:x.trading.assets.map((v:any)=>v.symbol===symbol?{...v,[key]:value}:v)}}));
  const saveTradingAsset=async(a:any)=>{setBusy(true);try{const r=await api(`/api/admin/trading/assets/${a.symbol}`,{method:"PUT",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(a)});setState((x:any)=>({...x,trading:{...x.trading,assets:x.trading.assets.map((v:any)=>v.symbol===a.symbol?r.asset:v)}}));onAction(`${a.symbol} trading settings saved`)}catch(e){onAction(e instanceof Error?e.message:"Asset save failed")}finally{setBusy(false)}};
  const addAdmin=async()=>{
    const email=newAdminEmail.trim().toLowerCase();
    if(!email){onAction("Enter the registered account email first.");return;}
    setBusy(true);
    try{
      const r=await api("/api/admin/admins",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({email})});
      setState((x:any)=>({...x,accounts:x.accounts.some((a:any)=>a.id===r.account.id)?x.accounts.map((a:any)=>a.id===r.account.id?r.account:a):[...x.accounts,r.account],admins:r.admins}));
      setNewAdminEmail("");
      onAction(`${r.account.displayName} is now an admin`);
    }catch(e){onAction(e instanceof Error?e.message:"Add admin failed")}finally{setBusy(false)}
  };
  const removeAdmin=async(id:number)=>{
    setBusy(true);
    try{
      const r=await api(`/api/admin/admins/${id}`,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}});
      setState((x:any)=>({...x,accounts:x.accounts.map((a:any)=>a.id===id?r.account:a),admins:r.admins}));
      onAction("Admin access removed");
    }catch(e){onAction(e instanceof Error?e.message:"Remove admin failed")}finally{setBusy(false)}
  };

  const saveAsset=async(key:string)=>{
    setBusy(true);
    try{
      await api(`/api/admin/assets/${encodeURIComponent(key)}`,{method:"PUT",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({url:state.assets[key]||""})});
      onAction(`${key} updated`);
    }catch(e){onAction(e instanceof Error?e.message:"Asset save failed")}finally{setBusy(false)}
  };

  if(loading)return <><PageHero kicker="ADMIN CONTROL" title="Admin Dashboard" text="Loading control center…"/><div className="panel admin-loading">Verifying administrator access...</div></>;
  if(!state)return <><PageHero kicker="ADMIN CONTROL" title="Admin Dashboard" text="Administrator access is unavailable for this GrowID."/><div className="panel admin-denied"><Shield size={24}/><strong>Admin access required</strong><span>Set TREE_PS_ADMIN_GROWIDS or TREE_PS_ADMIN_USER_IDS in backend/.env, then restart the backend.</span></div></>;

  return <><PageHero kicker="ADMIN CONTROL CENTER" title="Admin Dashboard" text="Configure TREE PS games, normal balance market settings, branding and website media."/>
    <div className="admin-tabs">{[["overview","Overview",LayoutDashboard],["accounts","Accounts",UserRound],["games","Games",Gamepad2],["economy","Economy",SlidersHorizontal],["gacha","Gacha",Gift],["trading","Trading",BarChart3],["media","Media Manager",Image],["site","Site",Settings]].map(([id,label,Icon]:any)=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}><Icon size={14}/>{label}</button>)}</div>

    {tab==="overview"&&<div className="admin-grid">
      <div className="panel admin-card"><div className="mini-label">ADMIN SESSION</div><h2>{state.user.clean_name}</h2><p>UID {state.user.user_id} • GrowID {state.user.growid}</p><span className="admin-ok"><Check size={12}/> VERIFIED ADMIN</span></div>
      <div className="panel admin-card"><div className="mini-label">WALLET MODE</div><strong>BALANCE</strong><p>Games no longer use a separate game-credit wallet</p></div>
      <div className="panel admin-card"><div className="mini-label">MARKET SYNC</div><strong>{state.site.marketRefreshMs} ms</strong><p>Frontend refresh interval</p></div>
      <div className="panel admin-card"><div className="mini-label">ACTIVE GAMES</div><strong>{state.games.filter((g:any)=>g.enabled).length}/{state.games.length}</strong><p>Enable or disable individual games</p></div>
    </div>}

    {tab==="economy"&&<div className="panel admin-form">
      <div className="form-section"><div><div className="mini-label">GAME ECONOMY</div><h3>Wallet Balance Mode</h3></div><button className="primary" disabled={busy} onClick={saveSite}><Save size={13}/> Save Economy</button></div>
      <div className="admin-form-grid">
        <div className="tiny-note">Game sessions are balance-safe: the wallet is displayed but never charged by Game Hub.</div>
        <label>Market Refresh (ms)<input type="number" min="1000" value={state.site.marketRefreshMs} onChange={e=>setSiteField("marketRefreshMs",Number(e.target.value))}/></label>
      </div>
    </div>}

    {tab==="accounts"&&<div className="panel admin-form">
      <div className="form-section"><div><div className="mini-label">WEB ACCOUNTS</div><h3>Registered Accounts</h3></div><span className="tiny-note">Passwords are never shown in the admin panel.</span></div>
      <div className="admin-admin-manager panel-subpanel">
        <div className="form-section compact-section"><div><div className="mini-label">ADMIN MANAGEMENT</div><h4>Manage Administrators</h4><span className="tiny-note">Add any registered TREE PS web account by email. Environment admins cannot be removed here.</span></div></div>
        <div className="admin-add-admin-row"><input value={newAdminEmail} onChange={e=>setNewAdminEmail(e.target.value)} placeholder="registered@email.com" type="email"/><button className="primary" disabled={busy} onClick={addAdmin}><ShieldCheck size={13}/> Add Admin</button></div>
        <div className="admin-admin-list">{(state.accounts||[]).filter((a:any)=>a.is_admin).length===0?<div className="tiny-note">No panel-managed admins yet.</div>:(state.accounts||[]).filter((a:any)=>a.is_admin).map((a:any)=><div className="admin-admin-row" key={a.id}><div><strong>{a.displayName}</strong><span>{a.email}</span></div><div className="admin-admin-actions"><span className="admin-ok"><ShieldCheck size={11}/> ADMIN</span><button className="tiny danger-btn" disabled={busy || String(state.user.web_account_id)===String(a.id)} onClick={()=>removeAdmin(a.id)}>{String(state.user.web_account_id)===String(a.id)?"CURRENT":"Remove"}</button></div></div>)}</div>
      </div>
      <div className="admin-account-list">{(state.accounts||[]).length===0?<div className="tiny-note">No registered web accounts yet.</div>:(state.accounts||[]).map((a:any)=><div className="admin-account-row" key={a.id}><div className="avatar">{String(a.displayName||"P").slice(0,1).toUpperCase()}</div><div><strong>{a.displayName}</strong><span>{a.email}</span></div><div className="admin-account-meta"><span>ID {a.id}</span><span>{a.is_admin?<b className="admin-account-role">ADMIN</b>:"USER"}</span><span>{new Date(a.createdAt).toLocaleDateString()}</span></div></div>)}</div>
    </div>}

    {tab==="games"&&<div className="admin-game-list">{state.games.map((g:any)=><div className="panel admin-game" key={g.id}>
      <div className="admin-game-top"><div><div className="mini-label">GAME</div><h3>{g.title}</h3><p>{g.id}</p></div><button className={g.enabled?"admin-switch on":"admin-switch"} onClick={()=>setGameField(g.id,"enabled",!g.enabled)}>{g.enabled?<><Power size={12}/> ON</>:<><Power size={12}/> OFF</>}</button></div>
      <div className="admin-form-grid compact">
        <label>Title<input value={g.title} onChange={e=>setGameField(g.id,"title",e.target.value)}/></label>
        <label>Badge<input value={g.badge} onChange={e=>setGameField(g.id,"badge",e.target.value)}/></label>
        <label>Description<input value={g.description} onChange={e=>setGameField(g.id,"description",e.target.value)}/></label>
        <label>WL Stakes<input value={(g.stakes||[]).join(",")} onChange={e=>setGameField(g.id,"stakes",e.target.value.split(",").map((v:string)=>Number(v.trim())).filter((v:number)=>Number.isFinite(v)&&v>0))} placeholder="10,25,50,100"/></label>
        <label>Max Stake (WL)<input type="number" min="1" value={g.maxStake} onChange={e=>setGameField(g.id,"maxStake",Number(e.target.value))}/></label>
        <label>Payout Scale<input type="number" min="0" max="10" step="0.05" value={g.payoutScale??1} onChange={e=>setGameField(g.id,"payoutScale",Number(e.target.value))}/></label>
        <div className="tiny-note">All game stakes are charged from the unified WL wallet and payouts return to that same wallet.</div>
      </div>
      <button className="secondary" disabled={busy} onClick={()=>saveGame(g)}><Save size={13}/> Save {g.title}</button>
    </div>)}</div>}

    {tab==="gacha"&&<div className="admin-gacha-list">{(state.gacha||[]).map((g:any)=><div className="panel admin-form" key={g.id}>
      <div className="form-section"><div><div className="mini-label">GACHA CHEST / {g.id}</div><h3>{g.title}</h3></div><div className="admin-inline-actions"><button className={g.enabled?'admin-switch on':'admin-switch'} onClick={()=>setGachaField(g.id,'enabled',!g.enabled)}>{g.enabled?<><Power size={12}/> ON</>:<><Power size={12}/> OFF</>}</button><button className="primary" disabled={busy} onClick={()=>saveGacha(g)}><Save size={13}/> Save Chest</button></div></div>
      <div className="admin-form-grid compact"><label>Title<input value={g.title} onChange={e=>setGachaField(g.id,'title',e.target.value)}/></label><label>Badge<input value={g.badge} onChange={e=>setGachaField(g.id,'badge',e.target.value)}/></label><label>Entry Price (WL)<input type="number" min="0" value={g.priceLocks??0} onChange={e=>setGachaField(g.id,'priceLocks',Math.max(0,Number(e.target.value)))}/></label><label className="wide-label">Description<input value={g.description} onChange={e=>setGachaField(g.id,'description',e.target.value)}/></label><label className="wide-label">Chest Image URL<input value={g.icon||''} onChange={e=>setGachaField(g.id,'icon',e.target.value)} placeholder="https://..."/></label></div>
      <div className="gacha-admin-rewards"><div className="form-section compact-section"><div><div className="mini-label">REWARDS</div><h4>Drop Table</h4></div><button className="secondary" onClick={()=>addGachaReward(g.id)}>+ Add Reward</button></div>
      {g.rewards.map((r:any,i:number)=><div className="gacha-reward-admin-row" key={r.id||i}><input value={r.name} onChange={e=>setGachaRewardField(g.id,i,'name',e.target.value)} placeholder="Reward name"/><input type="number" min="1" value={r.item_id} onChange={e=>setGachaRewardField(g.id,i,'item_id',Number(e.target.value))} placeholder="Item ID"/><input type="number" min="1" value={r.amount} onChange={e=>setGachaRewardField(g.id,i,'amount',Number(e.target.value))} placeholder="Amount"/><input value={r.rarity} onChange={e=>setGachaRewardField(g.id,i,'rarity',e.target.value)} placeholder="Rarity"/><input type="number" min="0" step="0.1" value={r.chance} onChange={e=>setGachaRewardField(g.id,i,'chance',Number(e.target.value))} placeholder="Chance"/><input value={r.image||''} onChange={e=>setGachaRewardField(g.id,i,'image',e.target.value)} placeholder="Image URL"/><button className="tiny danger-btn" onClick={()=>removeGachaReward(g.id,i)}>Remove</button></div>)}
      <div className="tiny-note">Chance values are weighted. They do not need to total exactly 100.</div></div>
    </div>)}</div>}

    {tab==="trading"&&<div className="admin-game-list">
      <div className="panel admin-form">
        <div className="form-section"><div><div className="mini-label">VIRTUAL MARKET</div><h3>Balance Trading Rules</h3></div><button className="primary" disabled={busy} onClick={saveTrading}><Save size={13}/> Save Trading</button></div>
        <div className="admin-form-grid">
          <label>Trading Enabled<button className={state.trading?.enabled?"admin-switch on":"admin-switch"} onClick={()=>setTradingField("enabled",!state.trading?.enabled)}>{state.trading?.enabled?<><Power size={12}/> ON</>:<><Power size={12}/> OFF</>}</button></label>
          <label>Fee (bps)<input type="number" min="0" max="1000" value={state.trading?.feeBps??0} onChange={e=>setTradingField("feeBps",Number(e.target.value))}/></label>
          <label>Minimum Order Cost (WL)<input type="number" min="1" value={state.trading?.minLocks??1} onChange={e=>setTradingField("minLocks",Number(e.target.value))}/></label>
          <label>Maximum Order Cost (WL)<input type="number" min="1" value={state.trading?.maxLocks??5000} onChange={e=>setTradingField("maxLocks",Number(e.target.value))}/></label>
        </div>
        <div className="tiny-note">Virtual trading uses the normal WL wallet balance. Live charts remain market-reference data.</div>
      </div>
      {(state.trading?.assets||[]).map((a:any)=><div className="panel admin-form" key={a.symbol}>
        <div className="form-section"><div><div className="mini-label">ASSET / {a.symbol}</div><h3>{a.name}</h3></div><button className={a.enabled?"admin-switch on":"admin-switch"} onClick={()=>setTradingAssetField(a.symbol,"enabled",!a.enabled)}>{a.enabled?<><Power size={12}/> ON</>:<><Power size={12}/> OFF</>}</button></div>
        <div className="admin-form-grid compact">
          <label>Asset Name<input value={a.name} onChange={e=>setTradingAssetField(a.symbol,"name",e.target.value)}/></label>
          <label>Virtual Price (WL)<input type="number" min="1" value={a.priceLocks} onChange={e=>setTradingAssetField(a.symbol,"priceLocks",Number(e.target.value))}/></label>
          <label>Min Amount<input type="number" min="0.000001" step="0.000001" value={a.minOrder} onChange={e=>setTradingAssetField(a.symbol,"minOrder",Number(e.target.value))}/></label>
          <label>Max Amount<input type="number" min="0.000001" step="0.000001" value={a.maxOrder} onChange={e=>setTradingAssetField(a.symbol,"maxOrder",Number(e.target.value))}/></label>
          <label>Logo Key<input value={a.logoKey} onChange={e=>setTradingAssetField(a.symbol,"logoKey",e.target.value)}/></label>
        </div>
        <button className="secondary" disabled={busy} onClick={()=>saveTradingAsset(a)}><Save size={13}/> Save {a.symbol}</button>
      </div>)}
    </div>}

    {tab==="media"&&<div className="panel admin-form">
      <div className="form-section"><div><div className="mini-label">GLOBAL ASSETS</div><h3>Media Manager</h3></div><span className="tiny-note">Paste image URLs. Empty URL uses the built-in logo.</span></div>
      <div className="media-grid">{Object.keys(state.assets).map(key=><div className="media-row" key={key}>
        <div className="media-preview"><CryptoLogo symbol={key.replace("logo_","").toUpperCase()} assets={state.assets}/></div>
        <div><strong>{key}</strong><input value={state.assets[key]||""} onChange={e=>setState((x:any)=>({...x,assets:{...x.assets,[key]:e.target.value}}))} placeholder="https://..."/></div>
        <button className="tiny" disabled={busy} onClick={()=>saveAsset(key)}>Save</button>
      </div>)}</div>
    </div>}

    {tab==="site"&&<div className="panel admin-form">
      <div className="form-section"><div><div className="mini-label">BRANDING</div><h3>Site Identity</h3></div><button className="primary" disabled={busy} onClick={saveSite}><Save size={13}/> Save Site</button></div>
      <div className="admin-form-grid">
        <label>Site Name<input value={state.site.siteName} onChange={e=>setSiteField("siteName",e.target.value)}/></label>
        <label>Tagline<input value={state.site.tagline} onChange={e=>setSiteField("tagline",e.target.value)}/></label>
        <label>Accent<input value={state.site.accent} onChange={e=>setSiteField("accent",e.target.value)}/></label>
        <label>Support Text<input value={state.site.supportText} onChange={e=>setSiteField("supportText",e.target.value)}/></label>
      </div>
    </div>}
  </>;
}

function SettingsPage({theme,setTheme,onLogout}:{theme:'dark'|'light';setTheme:(t:'dark'|'light')=>void;onLogout:()=>void}){return <><PageHero kicker="ACCOUNT" title="Settings" text="Manage your TREE PS web session and preferences."/><div className="settings-grid"><div className="setting-row"><div><strong>Theme</strong><span>Choose the dashboard theme.</span></div><div className="theme-toggle"><button className={theme==='light'?'on':''} onClick={()=>setTheme('light')}><Sun size={14}/> Light</button><button className={theme==='dark'?'on':''} onClick={()=>setTheme('dark')}><Moon size={14}/> Dark</button></div></div><div className="setting-row"><div><strong>Security</strong><span>Your web account is protected by your TREE PS password. GrowID linking remains separate.</span></div><span className="verified-pill"><Check size={12}/> VERIFIED</span></div><div className="setting-row"><div><strong>Web Session</strong><span>Sign out from this browser.</span></div><button className="secondary" onClick={onLogout}>Logout</button></div></div></>}

class AppErrorBoundary extends React.Component<{children:React.ReactNode},{error:Error|null}>{
  state = { error: null as Error | null };
  static getDerivedStateFromError(error:Error){ return { error }; }
  render(){
    if(this.state.error){
      return <div className="connect-page"><div className="connect-shell"><div className="connect-card"><div className="eyebrow"><Shield size={14}/> TREE PS ERROR</div><h1>Web interface failed to load</h1><p>{this.state.error.message || "Unknown frontend error"}</p><button className="secondary wide" onClick={()=>window.location.reload()}>Reload Page</button></div></div></div>;
    }
    return this.props.children;
  }
}

function App(){
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);

  useEffect(()=>{
    let dead=false;
    const check=async()=>{
      try{
        const raw=localStorage.getItem('treeps_session');
        if(!raw){ if(!dead)setChecking(false); return; }
        const saved=JSON.parse(raw) as Session;
        const r=await api('/api/auth/session',{headers:{Authorization:`Bearer ${saved.token}`}});
        if(r.authenticated&&r.user){
          const next={token:saved.token,user:{...saved.user,...r.user}} as Session;
          localStorage.setItem('treeps_session',JSON.stringify(next));
          if(!dead)setSession(next);
        }else{
          localStorage.removeItem('treeps_session');
        }
      }catch{
        localStorage.removeItem('treeps_session');
      }finally{
        if(!dead)setChecking(false);
      }
    };
    check();
    return()=>{dead=true};
  },[]);

  const logout=async()=>{
    const t=session?.token;
    localStorage.removeItem('treeps_session');
    setSession(null);
    if(t){
      try{await api('/api/auth/logout',{method:'POST',headers:{Authorization:`Bearer ${t}`}})}catch{}
    }
  };

  if(checking)return <div className="connect-page"><div className="connect-shell"><div className="connect-brand"><div className="brand-mark large">T</div><div><div className="brand-name">TREE PS</div><div className="brand-sub">PRIVATE SERVER</div></div></div><div className="connect-card"><div className="connect-status waiting"><span className="pulse-dot pulse"/><div><strong>Checking session...</strong><span>Verifying your TREE PS web session.</span></div></div></div></div></div>;
  if(!session) return <AuthScreen onAuthenticated={setSession}/>;
  const needsLink = !(session.user?.user_id && Number(session.user.user_id)>0 && (session.user.growid || session.user.clean_name));
  return needsLink ? <ConnectScreen token={session.token} onConnected={setSession} onLogout={logout}/> : <Dashboard session={session} onLogout={logout}/>;
}

createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App/></AppErrorBoundary>);
