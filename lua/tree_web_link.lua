-- ============================================================
-- TREE PS WEB LINK + WALLET BRIDGE
--
-- Commands:
--   /link TREE-XXXX-XXXX
--   /linkstatus
--   /unlink
--   /whoami
--   /webtest
--   /deposit <amount> [wl|dl|bgl|ggl]
--   /withdraw <amount> [wl|dl|bgl|ggl]
--   /claimgacha
--
-- This version is intentionally verbose on errors so a failed
-- request never leaves the player permanently at "Connecting...".
-- ============================================================

-- IMPORTANT: update WEB_BASE_URL whenever the Quick Tunnel URL changes.
local WEB_BASE_URL = "https://gtpstreps.vercel.app"

local SHARED_SECRET = "4D5F454C66278EE075F2CA5DE049E0DA1D95FAD937F0949E842DE7FF7CE9AAC9"

local WEB_HEALTH_URL            = WEB_BASE_URL .. "/health"
local WEB_VERIFY_URL            = WEB_BASE_URL .. "/api/auth/verify-link"
local WEB_DEPOSIT_URL           = WEB_BASE_URL .. "/api/lua/deposit"
local WEB_WITHDRAW_URL          = WEB_BASE_URL .. "/api/lua/withdraw"
local WEB_WITHDRAW_ROLLBACK_URL = WEB_BASE_URL .. "/api/lua/withdraw-rollback"
local WEB_GACHA_CLAIM_URL       = WEB_BASE_URL .. "/api/lua/gacha-claim"
local WEB_GACHA_RESTORE_URL     = WEB_BASE_URL .. "/api/lua/gacha-restore"

local STORAGE_PREFIX = "treeps_web_link_v2_"

-- Growtopia currency item IDs
local CURRENCIES = {
    wl  = { item_id = 242,  label = "WL"  },
    dl  = { item_id = 1796, label = "DL"  },
    bgl = { item_id = 7188, label = "BGL" },
    ggl = { item_id = 8470, label = "GGL" }
}

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------
local function tell(player, text)
    if player then
        player:onConsoleMessage("`w[TREE PS]`` " .. tostring(text))
    end
end

local function printError(prefix, res)
    print("[TREE PS] " .. prefix .. " | ok=" .. tostring(res and res.ok)
        .. " | status=" .. tostring(res and res.status)
        .. " | error=" .. tostring(res and res.error)
        .. " | body=" .. tostring(res and res.body or ""))
end

local function normalize(value)
    if type(value) ~= "string" then return "" end
    return value:gsub("^%s+", ""):gsub("%s+$", "")
end

local function storageKey(userID)
    return STORAGE_PREFIX .. tostring(userID)
end

local function getLinkData(userID)
    local data = loadDataFromServer(storageKey(userID))
    if type(data) ~= "table" then
        return nil
    end
    return data
end

local function saveLinkData(userID, data)
    return saveDataToServer(storageKey(userID), data)
end

local function isLinked(userID)
    local data = getLinkData(userID)
    return data ~= nil and data.linked == true
end

local function parseJSON(body)
    if type(body) ~= "string" or body == "" then
        return nil
    end
    local ok, result = pcall(json.decode, body)
    if not ok or type(result) ~= "table" then
        return nil
    end
    return result
end

local function sendRequest(player, requestOptions, callback)
    local ok = http.request(requestOptions)
    if ok ~= true then
        tell(player, "`4HTTP request could not be queued.")
        return false
    end
    return true
end

local function getCurrency(name)
    name = normalize(name):lower()
    return CURRENCIES[name], name
end

local function makeTransactionID(player, action, currency, amount)
    local now = os.time()
    local uid = tostring(player:getUserID())
    local randomPart = tostring(math.random(100000, 999999))
    return "TREE-" .. action .. "-" .. uid .. "-" .. currency .. "-" .. tostring(amount) .. "-" .. tostring(now) .. "-" .. randomPart
end

local function safeOnline(player)
    return player ~= nil and player:isOnline()
end

-- Resolve a fresh live Player handle before touching inventory from an
-- asynchronous HTTP callback. This avoids using a stale userdata reference
-- after the HTTP response returns. The API source documents getPlayer(userID)
-- as the online-player lookup by user ID.
local function livePlayer(userID, fallback)
    local p = getPlayer(userID)
    if p then return p end
    if fallback and fallback:isOnline() then return fallback end
    return nil
end

-- Grant directly from the HTTP callback and VERIFY the real backpack change.
-- A previous version trusted changeItem() too early and could report success
-- without the item actually being present in the player's inventory.
local function getInventoryItemCount(player, itemID)
    if not player then return 0 end

    local ok, items = pcall(function()
        return player:getInventoryItems()
    end)

    if not ok or type(items) ~= "table" then
        return 0
    end

    local total = 0
    for _, item in ipairs(items) do
        if item then
            local id, count = 0, 0
            pcall(function() id = item:getItemID() end)
            pcall(function() count = item:getItemCount() end)
            if tonumber(id) == tonumber(itemID) then
                total = total + (tonumber(count) or 0)
            end
        end
    end

    return total
end

local function grantInventory(userID, fallback, itemID, amount, onDone)
    local p = livePlayer(userID, fallback)
    if not p then
        onDone(false, nil, "player_offline")
        return
    end

    local before = getInventoryItemCount(p, itemID)

    local ok, result = pcall(function()
        return p:changeItem(itemID, amount, 0)
    end)

    if not ok then
        print("[TREE PS] changeItem ERROR | uid=" .. tostring(userID) .. " | item=" .. tostring(itemID) .. " | amount=" .. tostring(amount) .. " | error=" .. tostring(result))
        onDone(false, p, tostring(result))
        return
    end

    local after = getInventoryItemCount(p, itemID)
    local added = after - before

    print("[TREE PS] WD INVENTORY | uid=" .. tostring(userID) .. " | item=" .. tostring(itemID) .. " | requested=" .. tostring(amount) .. " | before=" .. tostring(before) .. " | after=" .. tostring(after) .. " | added=" .. tostring(added) .. " | result=" .. tostring(result))

    if result == true and added >= amount then
        onDone(true, p, nil)
        return
    end

    -- Protect against a partial/incorrect grant.
    if added > 0 then
        pcall(function()
            p:changeItem(itemID, -added, 0)
        end)
    end

    if result == false then
        onDone(false, p, "changeItem_returned_false")
    elseif added < amount then
        onDone(false, p, "inventory_added_" .. tostring(added) .. "_of_" .. tostring(amount))
    else
        onDone(false, p, "inventory_verification_failed")
    end
end

local function requestHeaders()
    return {
        ["Content-Type"] = "application/json",
        ["Accept"] = "application/json",
        ["Authorization"] = "Bearer " .. SHARED_SECRET,
        ["X-TREE-PS-SECRET"] = SHARED_SECRET
    }
end

-- ------------------------------------------------------------
-- /WEBTEST
-- ------------------------------------------------------------
local function webTest(player)
    tell(player, "`oTesting TREE PS Web connection...")

    sendRequest(player, {
        url = WEB_HEALTH_URL,
        method = "GET",
        headers = {
            ["Accept"] = "application/json",
            ["Authorization"] = "Bearer " .. SHARED_SECRET,
            ["X-TREE-PS-SECRET"] = SHARED_SECRET
        },
        callback = function(res)
            printError("WEBTEST", res)

            if not safeOnline(player) then
                return
            end

            if not res.ok then
                tell(player, "`4BACKEND CONNECTION FAILED")
                tell(player, "`oHTTP error: `w" .. tostring(res.error))
                return
            end

            tell(player, "`2BACKEND CONNECTION OK")
            tell(player, "`oHTTP: `w" .. tostring(res.status))
            tell(player, "`oResponse: `w" .. tostring(res.body or ""))
        end
    })
end

-- ------------------------------------------------------------
-- /LINK
-- ------------------------------------------------------------
local function linkAccount(player, rawCode)
    local code = normalize(rawCode):upper()

    if code == "" then
        tell(player, "`4Usage: /link TREE-XXXX-XXXX")
        return
    end

    local userID = player:getUserID()
    local growID = player:getName()
    local cleanName = player:getCleanName()
    local serverName = getServerName()

    -- Always capture the player object in the callback. Do not rely on
    -- getPlayer(userID) later; that can make a successful callback silent.
    tell(player, "`oConnecting to TREE PS Web...")
    tell(player, "`oCode: `w" .. code)
    tell(player, "`oAuth: `2TREE link handshake")

    local payload = {
        action = "verify_link",
        api_key = SHARED_SECRET,
        link_code = code,
        player = {
            user_id = userID,
            growid = growID,
            clean_name = cleanName
        },
        server = {
            name = serverName
        }
    }

    local queued = sendRequest(player, {
        url = WEB_VERIFY_URL,
        method = "POST",
        headers = requestHeaders(),
        body = json.encode(payload),
        callback = function(res)
            printError("LINK", res)

            if not safeOnline(player) then
                return
            end

            -- Every possible callback path produces a message.
            if not res.ok then
                tell(player, "`4TREE PS Web connection failed.")
                tell(player, "`oHTTP status: `w" .. tostring(res.status))
                tell(player, "`oHTTP error: `w" .. tostring(res.error))
                tell(player, "`oBody: `w" .. tostring(res.body or ""))
                return
            end

            local result = parseJSON(res.body or "")
            if not result then
                tell(player, "`4TREE PS returned invalid JSON.")
                tell(player, "`oHTTP: `w" .. tostring(res.status))
                tell(player, "`oBody: `w" .. tostring(res.body or ""))
                return
            end

            if res.status ~= 200 or result.success ~= true then
                tell(player, "`4Link failed: `w" .. tostring(result.message or result.error or ("HTTP " .. tostring(res.status))))
                return
            end

            local session = tostring(result.session or "")
            local saved = saveLinkData(userID, {
                linked = true,
                user_id = userID,
                growid = growID,
                clean_name = cleanName,
                server_name = serverName,
                session = session
            })

            if not saved then
                tell(player, "`4Website verified your account, but local link storage failed.")
                tell(player, "`oContact the server owner; do not relink repeatedly.")
                return
            end

            tell(player, "`2ACCOUNT CONNECTED!")
            tell(player, "`oGrowID: `w" .. cleanName)
            tell(player, "`oUser ID: `w" .. tostring(userID))
            tell(player, "`oWeb Status: `2CONNECTED")
        end
    }, true)

    if not queued then
        tell(player, "`4The request never left the server. Check /webtest.")
    end
end

-- ------------------------------------------------------------
-- /DEPOSIT
-- ------------------------------------------------------------
local function deposit(player, amountText, currencyText)
    local amount = tonumber(amountText or "")
    local currency, currencyName = getCurrency(currencyText or "wl")

    if not amount or amount <= 0 or amount ~= math.floor(amount) or not currency then
        tell(player, "`4Usage: /deposit <amount> [wl|dl|bgl|ggl]")
        return
    end

    if not isLinked(player:getUserID()) then
        tell(player, "`4Connect your GrowID first with /link.")
        return
    end

    local tx = makeTransactionID(player, "DEP", currencyName, amount)
    local uid = player:getUserID()

    -- IMPORTANT: changeItem() is the inventory API you supplied earlier.
    local removed = player:changeItem(currency.item_id, -amount, 0)
    if removed == false then
        tell(player, "`4Could not remove the items from your inventory.")
        return
    end

    tell(player, "`oDepositing `w" .. tostring(amount) .. " " .. currency.label .. "`o...")

    sendRequest(player, {
        url = WEB_DEPOSIT_URL,
        method = "POST",
        headers = requestHeaders(),
        body = json.encode({
            action = "deposit",
            api_key = SHARED_SECRET,
            transaction_id = tx,
            user_id = uid,
            growid = player:getCleanName(),
            currency = currencyName,
            amount = amount
        }),
        callback = function(res)
            printError("DEPOSIT", res)

            if not safeOnline(player) then
                return
            end

            if not res.ok then
                player:changeItem(currency.item_id, amount, 0)
                tell(player, "`4Deposit failed. Your items were returned.")
                tell(player, "`oHTTP error: `w" .. tostring(res.error))
                return
            end

            local result = parseJSON(res.body or "")
            if not result then
                player:changeItem(currency.item_id, amount, 0)
                tell(player, "`4Backend returned invalid JSON. Your items were returned.")
                return
            end

            if res.status ~= 200 or result.success ~= true then
                player:changeItem(currency.item_id, amount, 0)
                tell(player, "`4Deposit rejected: `w" .. tostring(result.message or result.error or res.status))
                return
            end

            tell(player, "`2Deposit successful: `w" .. tostring(amount) .. " " .. currency.label)
            if result.wallet then
                tell(player, "`oWeb balance: `w" .. tostring(result.wallet[currencyName] or 0) .. " " .. currency.label)
            end
        end
    })
end

-- ------------------------------------------------------------
-- /WITHDRAW
-- ------------------------------------------------------------
local function withdraw(player, amountText, currencyText)
    local amount = tonumber(amountText or "")
    local currency, currencyName = getCurrency(currencyText or "wl")

    if not amount or amount <= 0 or amount ~= math.floor(amount) or not currency then
        tell(player, "`4Usage: /withdraw <amount> [wl|dl|bgl|ggl]")
        return
    end

    if not isLinked(player:getUserID()) then
        tell(player, "`4Connect your GrowID first with /link.")
        return
    end

    local tx = makeTransactionID(player, "WDR", currencyName, amount)
    local uid = player:getUserID()

    tell(player, "`oWithdrawing `w" .. tostring(amount) .. " " .. currency.label .. "`o...")

    sendRequest(player, {
        url = WEB_WITHDRAW_URL,
        method = "POST",
        headers = requestHeaders(),
        body = json.encode({
            action = "withdraw",
            api_key = SHARED_SECRET,
            transaction_id = tx,
            user_id = uid,
            growid = player:getCleanName(),
            currency = currencyName,
            amount = amount
        }),
        callback = function(res)
            printError("WITHDRAW", res)

            if not safeOnline(player) then
                return
            end

            if not res.ok then
                tell(player, "`4Withdraw failed. Web balance was not changed.")
                tell(player, "`oHTTP error: `w" .. tostring(res.error))
                return
            end

            local result = parseJSON(res.body or "")
            if not result then
                tell(player, "`4Backend returned invalid JSON. Web balance was not changed.")
                return
            end

            if res.status ~= 200 or result.success ~= true then
                tell(player, "`4Withdraw rejected: `w" .. tostring(result.message or result.error or res.status))
                return
            end

            -- Use a fresh online Player handle and grant on the next engine tick.
            -- This is the critical WD fix.
            grantInventory(uid, player, currency.item_id, amount, function(added, live, reason)
                local p = live or livePlayer(uid, player)

                if not added then
                    -- Restore the deducted website balance if the inventory grant fails.
                    http.request({
                        url = WEB_WITHDRAW_ROLLBACK_URL,
                        method = "POST",
                        headers = requestHeaders(),
                        body = json.encode({
                            action = "withdraw_rollback",
                            api_key = SHARED_SECRET,
                            transaction_id = tx .. "-ROLLBACK",
                            user_id = uid,
                            currency = currencyName,
                            amount = amount
                        }),
                        callback = function(rollbackRes)
                            printError("WITHDRAW ROLLBACK", rollbackRes)
                            if safeOnline(p) then
                                if rollbackRes.ok and rollbackRes.status == 200 then
                                    tell(p, "`4Inventory grant failed; web balance restored.")
                                else
                                    tell(p, "`4Inventory grant failed and automatic web rollback failed. Check backend logs immediately.")
                                end
                            end
                        end
                    })

                    if safeOnline(p) then
                        tell(p, "`4Withdrawal inventory grant failed.")
                        tell(p, "`oReason: `w" .. tostring(reason or "unknown"))
                    end
                    return
                end

                if safeOnline(p) then
                    tell(p, "`2Withdraw successful: `w" .. tostring(amount) .. " " .. currency.label)
                    tell(p, "`oAdded to Backpack: `w" .. tostring(amount) .. " " .. currency.label)
                    if result.wallet then
                        tell(p, "`oRemaining web balance: `w" .. tostring(result.wallet[currencyName] or 0) .. " " .. currency.label)
                    end
                end
            end)
        end
    })
end

-- ------------------------------------------------------------
-- /CLAIMGACHA
-- ------------------------------------------------------------
local function claimGacha(player)
    local uid = player:getUserID()

    if not isLinked(uid) then
        tell(player, "`4Connect your GrowID first with /link.")
        return
    end

    tell(player, "`oChecking pending Gacha rewards...")

    sendRequest(player, {
        url = WEB_GACHA_CLAIM_URL,
        method = "POST",
        headers = requestHeaders(),
        body = json.encode({
            action = "claim_gacha",
            api_key = SHARED_SECRET,
            user_id = uid,
            growid = player:getCleanName()
        }),
        callback = function(res)
            printError("GACHA CLAIM", res)

            if not safeOnline(player) then
                return
            end

            if not res.ok then
                tell(player, "`4Gacha claim failed: `w" .. tostring(res.error))
                return
            end

            local result = parseJSON(res.body or "")
            if not result then
                tell(player, "`4Gacha backend returned invalid JSON.")
                return
            end

            if res.status ~= 200 or result.success ~= true then
                tell(player, "`4Gacha claim rejected: `w" .. tostring(result.message or result.error or res.status))
                return
            end

            local rewards = result.rewards or {}
            if #rewards == 0 then
                tell(player, "`oNo pending Gacha rewards.")
                return
            end

            local remaining = {}

            for i, reward in ipairs(rewards) do
                local itemID = tonumber(reward.item_id or 0) or 0
                local amount = tonumber(reward.amount or 0) or 0

                if itemID > 0 and amount > 0 then
                    local added = player:changeItem(itemID, amount, 0)
                    if added == false then
                        for j = i, #rewards do
                            remaining[#remaining + 1] = rewards[j]
                        end
                        break
                    end

                    tell(player, "`2Gacha claimed: `w" .. tostring(amount) .. " x item " .. tostring(itemID))
                end
            end

            if #remaining == 0 then
                tell(player, "`2All pending Gacha rewards claimed successfully.")
                return
            end

            http.request({
                url = WEB_GACHA_RESTORE_URL,
                method = "POST",
                headers = requestHeaders(),
                body = json.encode({
                    action = "restore_gacha",
                    api_key = SHARED_SECRET,
                    user_id = uid,
                    rewards = remaining
                }),
                callback = function(restoreRes)
                    printError("GACHA RESTORE", restoreRes)
                    if safeOnline(player) then
                        if restoreRes.ok and restoreRes.status == 200 then
                            tell(player, "`4Some rewards could not fit in inventory; they were returned to pending claims.")
                        else
                            tell(player, "`4Some rewards could not be claimed and automatic restore failed. Check backend logs.")
                        end
                    end
                end
            })
        end
    })
end

-- ------------------------------------------------------------
-- Commands
-- ------------------------------------------------------------
onPlayerCommandCallback(function(world, player, fullCommand)
    local cmd, args = fullCommand:match("^(%S+)%s*(.*)$")
    if not cmd then
        return false
    end

    cmd = cmd:lower()

    if cmd == "webtest" then
        webTest(player)
        return true
    end

    if cmd == "link" then
        linkAccount(player, args)
        return true
    end

    if cmd == "linkstatus" then
        local data = getLinkData(player:getUserID())
        if data and data.linked == true then
            tell(player, "`2WEB ACCOUNT CONNECTED")
            tell(player, "`oGrowID: `w" .. tostring(data.clean_name or player:getCleanName()))
            tell(player, "`oUser ID: `w" .. tostring(data.user_id or player:getUserID()))
            tell(player, "`oServer: `w" .. tostring(data.server_name or getServerName()))
        else
            tell(player, "`4WEB ACCOUNT NOT CONNECTED")
        end
        return true
    end

    if cmd == "unlink" then
        local ok = saveLinkData(player:getUserID(), { linked = false })
        tell(player, ok and "`2TREE PS web link removed." or "`4Failed to remove web link.")
        return true
    end

    if cmd == "whoami" then
        local uid = player:getUserID()
        tell(player, "`oGrowID: `w" .. player:getCleanName())
        tell(player, "`oUser ID: `w" .. tostring(uid))
        tell(player, "`oServer: `w" .. getServerName())
        tell(player, "`oWeb: " .. (isLinked(uid) and "`2CONNECTED" or "`4NOT CONNECTED"))
        return true
    end

    if cmd == "deposit" then
        local amount, currency = args:match("^(%d+)%s*(%a*)$")
        deposit(player, amount, currency ~= "" and currency or "wl")
        return true
    end

    if cmd == "withdraw" then
        local amount, currency = args:match("^(%d+)%s*(%a*)$")
        withdraw(player, amount, currency ~= "" and currency or "wl")
        return true
    end

    if cmd == "claimgacha" then
        claimGacha(player)
        return true
    end

    return false
end)

onPlayerLoginCallback(function(player)
    local data = getLinkData(player:getUserID())
    if data and data.linked == true then
        print("[TREE PS LINK] LOGIN LINKED | " .. player:getCleanName() .. " | " .. tostring(player:getUserID()))
    end
end)

onPlayerDisconnectCallback(function(player)
    print("[TREE PS LINK] DISCONNECT | " .. player:getCleanName() .. " | " .. tostring(player:getUserID()))
end)

print("============================================================")
print(" TREE PS WEB LINK + WALLET BRIDGE v2")
print("============================================================")
print(" Base URL      = " .. WEB_BASE_URL)
print(" /link         = ENABLED")
print(" /linkstatus   = ENABLED")
print(" /unlink       = ENABLED")
print(" /whoami       = ENABLED")
print(" /webtest      = ENABLED")
print(" /deposit      = ENABLED")
print(" /withdraw     = ENABLED")
print(" /claimgacha   = ENABLED")
print(" Web balance   = 0 on first link")
print("============================================================")
