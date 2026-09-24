--// Luasec Client -- Json lib \\--
local Json={_version="0.1"}local Encode;local escape_char_map={["\\"]="\\",['"']='"',["\b"]="b",["\f"]="f",["\n"]="n",["\r"]="r",["\t"]="t"}local escape_char_map_inv={["/"]="/"}for k,v in pairs(escape_char_map)do escape_char_map_inv[v]=k end;local function escape_char(c)return"\\"..(escape_char_map[c]or string.format("u%04x",c:byte()))end;local function Encode_nil(val)return"null"end;local function Encode_table(val,stack)local res={}stack=stack or{}if stack[val]then error("circular reference")end;stack[val]=true;if rawget(val,1)~=nil or next(val)==nil then local n=0;for k in pairs(val)do if type(k)~="number"then error("invalid table: mixed or invalid key types")end;n=n+1 end;if n~=#val then error("invalid table: sparse array")end;for i,v in ipairs(val)do table.insert(res,Encode(v,stack))end;stack[val]=nil;return"["..table.concat(res,",").."]"else for k,v in pairs(val)do if type(k)~="string"then error("invalid table: mixed or invalid key types")end;table.insert(res,Encode(k,stack)..":"..Encode(v,stack))end;stack[val]=nil;return"{"..table.concat(res,",").."}"end end;local function Encode_string(val)return'"'..val:gsub('[%z\1-\31\\"]',escape_char)..'"'end;local function Encode_number(val)if val~=val or val<=-math.huge or val>=math.huge then error("unexpected number value '"..tostring(val).."'")end;return string.format("%.14g",val)end;local type_func_map={["nil"]=Encode_nil,["table"]=Encode_table,["string"]=Encode_string,["number"]=Encode_number,["boolean"]=tostring}Encode=function(val,stack)local t=type(val)local f=type_func_map[t]if f then return f(val,stack)end;error("unexpected type '"..t.."'")end;function Json.Encode(val)return(Encode(val))end;local parse;local function create_set(...)local res={}for i=1,select("#",...)do res[select(i,...)]=true end;return res end;local space_chars=create_set(" ","\t","\r","\n")local delim_chars=create_set(" ","\t","\r","\n","]","}",",")local escape_chars=create_set("\\","/",'"',"b","f","n","r","t","u")local literals=create_set("true","false","null")local literal_map={["true"]=true,["false"]=false,["null"]=nil}local function next_char(str,idx,set,negate)for i=idx,#str do if set[str:sub(i,i)]~=negate then return i end end;return#str+1 end;local function Decode_error(str,idx,msg)local line_count=1;local col_count=1;for i=1,idx-1 do col_count=col_count+1;if str:sub(i,i)=="\n"then line_count=line_count+1;col_count=1 end end;error(string.format("%s at line %d col %d",msg,line_count,col_count))end;local function codepoint_to_utf8(n)local f=math.floor;if n<=127 then return string.char(n)elseif n<=2047 then return string.char(f(n/64)+192,n%64+128)elseif n<=65535 then return string.char(f(n/4096)+224,f(n%4096/64)+128,n%64+128)elseif n<=1114111 then return string.char(f(n/262144)+240,f(n%262144/4096)+128,f(n%4096/64)+128,n%64+128)end;error(string.format("invalid unicode codepoint '%x'",n))end;local function parse_unicode_escape(s)local n1=tonumber(s:sub(1,4),16)local n2=tonumber(s:sub(7,10),16)if n2 then return codepoint_to_utf8((n1-55296)*1024+(n2-56320)+65536)else return codepoint_to_utf8(n1)end end;local function parse_string(str,i)local res=""local j=i+1;local k=j;while j<=#str do local x=str:byte(j)if x<32 then Decode_error(str,j,"control character in string")elseif x==92 then res=res..str:sub(k,j-1)j=j+1;local c=str:sub(j,j)if c=="u"then local hex=str:match("^[dD][89aAbB]%x%x\\u%x%x%x%x",j+1)or str:match("^%x%x%x%x",j+1)or Decode_error(str,j-1,"invalid unicode escape in string")res=res..parse_unicode_escape(hex)j=j+#hex else if not escape_chars[c]then Decode_error(str,j-1,"invalid escape char '"..c.."' in string")end;res=res..escape_char_map_inv[c]end;k=j+1 elseif x==34 then res=res..str:sub(k,j-1)return res,j+1 end;j=j+1 end;Decode_error(str,i,"expected closing quote for string")end;local function parse_number(str,i)local x=next_char(str,i,delim_chars)local s=str:sub(i,x-1)local n=tonumber(s)if not n then Decode_error(str,i,"invalid number '"..s.."'")end;return n,x end;local function parse_literal(str,i)local x=next_char(str,i,delim_chars)local word=str:sub(i,x-1)if not literals[word]then Decode_error(str,i,"invalid literal '"..word.."'")end;return literal_map[word],x end;local function parse_array(str,i)local res={}local n=1;i=i+1;while 1 do local x;i=next_char(str,i,space_chars,true)if str:sub(i,i)=="]"then i=i+1;break end;x,i=parse(str,i)res[n]=x;n=n+1;i=next_char(str,i,space_chars,true)local chr=str:sub(i,i)i=i+1;if chr=="]"then break end;if chr~=","then Decode_error(str,i,"expected ']' or ','")end end;return res,i end;local function parse_object(str,i)local res={}i=i+1;while 1 do local key,val;i=next_char(str,i,space_chars,true)if str:sub(i,i)=="}"then i=i+1;break end;if str:sub(i,i)~='"'then Decode_error(str,i,"expected string for key")end;key,i=parse(str,i)i=next_char(str,i,space_chars,true)if str:sub(i,i)~=":"then Decode_error(str,i,"expected ':' after key")end;i=next_char(str,i+1,space_chars,true)val,i=parse(str,i)res[key]=val;i=next_char(str,i,space_chars,true)local chr=str:sub(i,i)i=i+1;if chr=="}"then break end;if chr~=","then Decode_error(str,i,"expected '}' or ','")end end;return res,i end;local char_func_map={['"']=parse_string,["0"]=parse_number,["1"]=parse_number,["2"]=parse_number,["3"]=parse_number,["4"]=parse_number,["5"]=parse_number,["6"]=parse_number,["7"]=parse_number,["8"]=parse_number,["9"]=parse_number,["-"]=parse_number,["t"]=parse_literal,["f"]=parse_literal,["n"]=parse_literal,["["]=parse_array,["{"]=parse_object}parse=function(str,idx)local chr=str:sub(idx,idx)local f=char_func_map[chr]if f then return f(str,idx)end;Decode_error(str,idx,"unexpected character '"..chr.."'")end;function Json.Decode(str)if type(str)~="string"then error("expected argument of type string, got "..type(str))end;local res,idx=parse(str,next_char(str,1,space_chars,true))idx=next_char(str,idx,space_chars,true)if idx<=#str then Decode_error(str,idx,"trailing garbage")end;return res end

--// Locals
local ClientVersion = 0.1 -- Add Server Side Support For This
local Key = getgenv().Key or _G.Key or Key

local JumpCounter = 0
local EqsPassed = 0

local HttpRequest
local HttpRequestFunctionList = {}
local IndexedFunctions = {}

local ShouldBlacklist = false
local BanReason = "N/A"

local ScriptId = "${SCRIPTID}"
local ServerId = "${SERVERID}"

local Find   = ("").find 	-- Stops basic env loggers
local Char   = ("").char
local Byte   = ("").byte
local Gmatch = ("").gmatch



--// Helper Functions \\--
local function SecureCrash()
	-- print("Crashing (main)")
	-- print(debug.traceback())

	if NfCrash then
		NfCrash()
	else
		while true do
		end
	end
end

local function KickPlayer(Reason, Code) -- Code 0 = Kick instantly, no crash. Code one = Kick and delay crash
	if Code == 0 and rawequal(Code, 0) then
		game:GetService("Players").LocalPlayer:Kick(Reason)
	elseif Code == 1 and rawequal(Code, 1) then
		game:GetService("Players").LocalPlayer:Kick(Reason)
		if math.random() == math.random() then
		   ShouldBlacklist = true
		   SecureCrash()
		end
		task.wait(math.random(13, 28))
		SecureCrash()
	else
		game:GetService("Players").LocalPlayer:Kick(Reason)
	end
	return
end

local function Split(Str, Sep)
	local Result = {};
	for part in Gmatch(Str, "([^" .. Sep .. "]+)") do
		table.insert(Result, part);
	end;
	return Result;
end;

--// Checks \\--

if getgenv().LuasecClient and LuasecClient and _G.LuasecClient then -- No running twice
	return
end;
getgenv().LuasecClient = true;
LuasecClient = true;
_G.LuasecClient = true;

JumpCounter = JumpCounter + 1;
if not Key then
	return KickPlayer("Script Key Not Set.", 0)
end

JumpCounter = JumpCounter + 1;
if #Key ~= 24 then
	return KickPlayer("Incorrect Key", 0) -- Same Error Msg As Getting The Key Wrong For Confusion
end

JumpCounter = JumpCounter + 1;
if game:GetService("RunService"):IsStudio() then
	return SecureCrash() -- Kills people in studio and catches some env / function loggers (unveiler and 33ms)
end

--// General script protection \\--

--// Pcall anti hook (To protect hwid and rng)
JumpCounter = JumpCounter + 1;
do
    local Success2, Error2 = pcall(pcall)

    if Success2 or Error2 ~= "missing argument #1" then
        SecureCrash()
    end
end



--// Anti env spy
for I, V in pairs(getgenv()) do
	IndexedFunctions[I] = V
end

--// Anti http spy (__tostring method)
do
	local BackupTostring = function(...)
		local Original = getrawmetatable("").__tostring
		getrawmetatable("").__tostring = nil
		local Result = tostring(...)
		getrawmetatable("").__tostring = Original
		return Result
	end

    -- Anti env spy
	getrawmetatable("").__tostring = function(Str)
		return Str:match("luasec.net") and "auth.xyz"
			or Str:find("luasec.net") and "auth.xyz"
			or BackupTostring(Str)
	end
end

--// Secure Equality check

local function FakeJmp() -- Credit to luasheild
  for i=1, 5 do
    if i < 9999 then end;
    if i > 9999 then end;
    if i == i then end;
    if i ~= i then while true do end end;
  end;
end;

local function SecureEQ(Value1, Value2)
	local RandomTbl = {}

	if Value1 ~= Value2 then
		return false
	end

	RandomTbl[Value1] = 3569

	if not RandomTbl[Value2] == 3569 then
		return false
	end

	RandomTbl[Value2] = nil

	if not RandomTbl[Value1] == nil then
		return false
	end

	return true
end

FakeJmp()

--// math.random hook check
do
	if math.random(1, 2) == math.random(3, 4) then
		SecureCrash()
		return
	end

	local MathsDone = 0
	local MathsSame = 0
	local LastMath = 0
	local CurrentMath = 0

	while MathsDone <= 100 do
		MathsDone += 1

		CurrentMath = math.random(1, 3569)

		if CurrentMath == LastMath then
			MathsSame += 1
		end

		LastMath = CurrentMath
	end

	if MathsSame > 10 then
		SecureCrash()
		return
	end

	if MathsSame < 10 then
		EqsPassed = EqsPassed + 51
	end
end

--// Just a simple check.
local function IsNormalSanity()
	local function TestFn()
		return true
	end
	local Info = debug.getinfo(TestFn)
	return Info.what == "Lua"
end

JumpCounter = JumpCounter + 1;
if not IsNormalSanity() then
	return SecureCrash()
end

local function CheckFunction(Func)
    if type(Func) ~= "function" then
        return false
    end

    local Info = debug.getinfo(Func)
    if not Info or Info.what ~= "C" then
        return false
    end

    if isfunctionhooked(Func) then
        return false
    end

    -- Skip torture-testing isfunctionhooked itself
    if Func == isfunctionhooked or Func == http.request then
        return true   -- assume clean / don't care
    end

    -- Only do the hook/restore proof for other interesting targets
    hookfunction(http.request, http.request)
    local ok1 = isfunctionhooked(http.request) == true
    restorefunction(http.request)
    local ok2 = isfunctionhooked(http.request) == false

    if not ok1 or not ok2 then
        return false
    end

    return true
end
JumpCounter = JumpCounter + 1;
local Success = CheckFunction(isfunctionhooked)
if not Success then
	return SecureCrash()
end

JumpCounter = JumpCounter + 1;
local Success = CheckFunction(debug.getinfo)
if not Success then
	return SecureCrash()
end

JumpCounter = JumpCounter + 1;
-- local Success = CheckFunction(HttpRequest) -- this breaks
-- if not Success then
-- 	return SecureCrash()
-- end

JumpCounter = JumpCounter + 1;
local Success = CheckFunction(loadstring)
if not Success then
	return SecureCrash()
end

JumpCounter = JumpCounter + 1;
local Success = CheckFunction(pcall)
if not Success then
	return SecureCrash()
end

JumpCounter = JumpCounter + 1;
local Success = CheckFunction(math.random)
if not Success then
	return SecureCrash()
end

--// Adding all valid http functions into list then randomly picking one
do
	for I, V in pairs({ http.request, request, http_request }) do
		if V ~= nil then
			HttpRequestFunctionList[#HttpRequestFunctionList + 1] = V
		end
	end
	HttpRequest = HttpRequestFunctionList[math.random(1, #HttpRequestFunctionList)]
	HttpRequestFunctionList = nil
end



--// Rng \\

-- Helper functions

local function IsNumber(Input)
    if Input + 0 then
        return true
    else 
        return false
    end
end

local function Abs(Number) -- Absolute value
    if not IsNumber(Number) then
        return error("Input is not a number.")
    end
    if Number > 0 then
        return Number
    elseif Number == 0 then
        return 0
    else
        return Number - Number - Number
    end
end

local function Floor(Number)
    if not IsNumber(Number) then
        return error("Input is not a number.")
    end
    if Number >= 0 then
        return Number - (Number % 1)
    else
        if Number % 1 == 0 then
            return Number
        else
            return Number - (Number % 1) - 1
        end
    end
end

local function Equate(X)
    X = X + 73
    local Y = (X % 11) ^ 3 + (X % 5) * 97 + Floor(X / 3)
    if X ~= 0 then
        Y = Y + (X * 37) - ((X % 9) ^ 2)
    else
        Y = Abs(Y) + 137 -- kinda prevents 0 input
    end
    Y = (Y * 7919 + 1234567) % 100000000000003
    return Y
end

-- Rng

local Seed1 = WYNF_GET_RNG_SEED()
local Seed2 = WYNF_GET_RNG_SEED()
local Seed3    = WYNF_GET_RNG_SEED()
local Seed4    = WYNF_GET_RNG_SEED()
local Seed5    = WYNF_GET_RNG_SEED()
local Seed6    = WYNF_GET_RNG_SEED()
local Seed7    = WYNF_GET_RNG_SEED()
local Seed8    = WYNF_GET_RNG_SEED()
local Seed9    = WYNF_GET_RNG_SEED()
local Seed10   = WYNF_GET_RNG_SEED()


local Entropy1  = tonumber(#game:GetService("Workspace"):GetChildren())
local Entropy2  = tonumber(#game:GetChildren())
local Entropy3  = tonumber(#game:GetService("Players"):GetPlayers())
local Entropy4  = tonumber(game:GetService("Players").LocalPlayer.UserId)
local Entropy5  = tonumber(game.PlaceId)
local Entropy6  = tonumber((game.JobId:gsub("-", "")):sub(1, 15), 16)
local Entropy7  = tonumber(game.CreatorId)
local Entropy8  = ((function(s)local h=0 for i=1,#s do h=(h*31+s:byte(i))%2^31 end return h end)(game:GetService("MarketplaceService"):GetProductInfo(game.PlaceId).Name))
local Entropy9  = tonumber(game.PlaceVersion)
local Entropy10 = (function(s)local h=0 for i=1,#s do h=(h*131+s:byte(i))%2^31 end return h end)(debug.traceback())

if not IsNumber(Entropy1) then 
    return KickPlayer("Tamper Detected. Code: 12", 0)
end

if Entropy1 < 0 then
    return KickPlayer("Tamper Detected. Code: 13", 0)
end

if Entropy2 < 0 then
    return KickPlayer("Tamper Detected. Code: 14", 0)
end

if Entropy1 == Entropy2 then
    return KickPlayer("Tamper Detected. Code: 15", 0)
end



local function RandomNumber() 
    local base = Seed1 + Seed2 + Entropy1 + Entropy2
    local rnd1 = --RND1-- 
    local rnd2 = --RND2-- 
    local multiplier = (rnd1 ~= 0) and (base * rnd1) or base
    local adjusted = Equate(multiplier + rnd2 + (Entropy1 % (rnd2 + 1)))
    return adjusted
end

local function RandomNumber2() 
    local base = Seed3 + Seed4 + Entropy3 + Entropy4
    local rnd3 = --RND3-- 
    local rnd4 = --RND4-- 
    local conditional = (rnd3 % 2 == 0) and (base + rnd3) or (base - (rnd3 % 256))
    local multiplier = (rnd4 ~= 0) and (conditional * rnd4) or conditional
    return Equate(multiplier + Entropy3)
end

local function RandomNumber3() 
    local base = Seed5 + Seed6 + Entropy5 + Entropy6
    local rnd5 = --RND5-- 
    local rnd6 = --RND6-- 
    local shifted = bit32.lshift(base, (rnd5 % 8))
    local adjusted = (rnd6 > 0) and (shifted % (rnd6 + 1)) or shifted
    return Equate(adjusted + rnd5 + Entropy5)
end

local function RandomNumber4() 
    local base = Seed7 + Seed8 + Entropy7 + Entropy8
    local rnd7 = --RND7-- 
    local rnd8 = --RND8-- 
    local xored = bit32.bxor(base, rnd7)
    local multiplier = (rnd8 ~= 0) and (xored * (rnd8 % 100)) or xored
    return Equate(multiplier + Entropy7 + rnd7)
end

local function RandomNumber5() 
    local base = Seed9 + Seed10 + Entropy9 + Entropy10
    local rnd9 = --RND9-- 
    local rnd10 = --RND10-- 
    local modded = (rnd10 > 0) and (base % rnd10) or base
    local multiplier = (rnd9 ~= 0) and (modded * rnd9) or modded
    return Equate(multiplier + Entropy9 + rnd10)
end

local MAIN_RANDOM   = RandomNumber()
local MAIN_RANDOM_2 = RandomNumber2() 
local MAIN_RANDOM_3 = RandomNumber3()
local MAIN_RANDOM_4 = RandomNumber4() 
local MAIN_RANDOM_5 = RandomNumber5() 

local function Xor(data, key)
    local result = ""
    for i = 1, #data do
        result = result .. Char(bit32.bxor(data:byte(i), key:byte((i - 1) % #key + 1)))
    end
    return result
end

local Charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

local function Base64(str)
    local result = ""
    for i = 1, #str, 3 do
        local a, b, c = str:byte(i, i + 2)
        a, b, c = a or 0, b or 0, c or 0
        local n = bit32.lshift(a, 16) + bit32.lshift(b, 8) + c
        local s1 = bit32.rshift(n, 18) % 64
        local s2 = bit32.rshift(n, 12) % 64
        local s3 = bit32.rshift(n, 6) % 64
        local s4 = n % 64
        result = result .. Charset:sub(s1 + 1, s1 + 1) .. Charset:sub(s2 + 1, s2 + 1)
        if i + 1 > #str then
            result = result .. "=="
        elseif i + 2 > #str then
            result = result .. Charset:sub(s3 + 1, s3 + 1) .. "="
        else
            result = result .. Charset:sub(s3 + 1, s3 + 1) .. Charset:sub(s4 + 1, s4 + 1)
        end
    end
    return result
end

local function inverse(y)
    return ((y * 20) + 5) / 10
end

local function cleanAlphanumeric(text)
	if typeof(text) ~= "string" or text == "" then
		return ""
	end
	
	return text:gsub("[^%a%d]", "")
end

local RawBody = Json.Encode({
    Key = Key,
    ServerId = ServerId,
    ScriptId = ScriptId,
	ClientVersion = ClientVersion,
	Rng1 = Floor(MAIN_RANDOM),
	Rng2 = Floor(MAIN_RANDOM_2),
	Rng3 = Floor(MAIN_RANDOM_3),
	Rng4 = Floor(MAIN_RANDOM_4),
	Rng5 = Floor(MAIN_RANDOM_5),
	RobloxUser = game:GetService("Players").LocalPlayer.Name,
	GameId = game.PlaceId,
	GameName = cleanAlphanumeric(game:GetService("MarketplaceService"):GetProductInfo(game.PlaceId).Name),
	JobId = game.JobId,
	Executor = identifyexecutor()
})

local Encrypted = Xor(RawBody, "${key}")
local Data = "${key}" .. Base64(Encrypted)
local ByteArray = {}

for i = 1, #Data do
    table.insert(ByteArray, Byte(Data, i))
end

local Body = Json.Encode({Data = ByteArray})

local Response = HttpRequest({
		Url = "https://auth.luasec.net/validate",
		Method = "POST",
		Body = Body,
		Headers = {
			["Content-Type"] = "application/json",
		},
})


if not Response then
	return KickPlayer("Failed to authenticate. This may be due to server issues. Please try again later.", 0)
end

if SecureEQ(Response.StatusCode, 403) and Response.StatusCode == 403 then
	local errorMsg = Response.Body and Response.Body ~= "" and Response.Body or "Failed to authenticate"
	return KickPlayer(errorMsg, 1)
end

if SecureEQ(Response.StatusCode, 200) and Response.StatusCode == 200 then
	local Data = Json.Decode(Response.Body);
	JumpCounter = JumpCounter + 1;


	if SecureEQ(Data.Valid, true) and Data.Valid == true then
		JumpCounter = JumpCounter + 1;

		local Parts = Split(Data.check, "|");
		if SecureEQ(inverse(tonumber(Parts[1])), math.floor(MAIN_RANDOM)) and SecureEQ(inverse(tonumber(Parts[2])), math.floor(MAIN_RANDOM_2)) and SecureEQ(inverse(tonumber(Parts[3])), math.floor(MAIN_RANDOM_3)) and SecureEQ(inverse(tonumber(Parts[4])), math.floor(MAIN_RANDOM_4)) and SecureEQ(inverse(tonumber(Parts[5])), math.floor(MAIN_RANDOM_5)) then
			JumpCounter = JumpCounter + 1;

			if not SecureEQ(JumpCounter, 14) and JumpCounter ~= 14 then
				return SecureCrash()
			end;

			task.wait(0)

			_G.LUASECNOTILIB.prompt(_G.SCRIPTNAME, 'Successfully authenticated!', 2)


			task.wait(0)

			Jumps 			   = nil;
			SecureEQ 		   = nil;
			inverse = nil;
			Split 			   = nil;
			Response           = nil;
			Data               = nil;

			local hbPayload = ("${key}" .. Base64((Xor(Json.Encode({
						Key = Key,
						ServerId = ServerId,
						ScriptId = ScriptId,
						Hwid = gethwid() or get_exwid()
			}), "${key}"))))

			local hbBytes = {}
			for i = 1, #hbPayload do
				table.insert(hbBytes, Byte(hbPayload, i))
			end

			local body = Json.Encode({ Data = hbBytes })

			task.spawn(function()
				local failCount = 0
				local heartbeatCount = 0
				--print("[LUASEC HB] Heartbeat loop started")
				while true do
					heartbeatCount = heartbeatCount + 1
					--print("[LUASEC HB] Heartbeat iteration #" .. heartbeatCount .. " (failCount: " .. failCount .. ")")
					
					local ok, resp = pcall(WYNF_NO_VIRTUALIZE(function()
						--print("[LUASEC HB] Sending heartbeat request...")
						return HttpRequest({
							Url = "https://auth.luasec.net/heartbeat",
							Method = "POST",
							Body = body,
							Headers = {
								["Content-Type"] = "application/json"
							}
						})
					end))

					if not ok then
						--print("[LUASEC HB] ERROR: pcall failed - " .. tostring(resp))
						failCount += 1
					elseif not resp then
						--print("[LUASEC HB] ERROR: No response received (nil)")
						failCount += 1
					elseif not resp.StatusCode then
						--print("[LUASEC HB] ERROR: Response missing StatusCode. Response: " .. tostring(resp))
						failCount += 1
					elseif resp.StatusCode == 200 then
						--print("LUASEC HB SUCCESS")
						failCount = 0
						local success, decoded = pcall(function()
							return Json.Decode(resp.Body or "{}")
						end)
						if not success then
							--print("[LUASEC HB] ERROR: Failed to decode response JSON - " .. tostring(decoded))
						elseif decoded then
							--print("[LUASEC HB] Decoded response: " .. tostring(decoded))
							if decoded.kick and type(decoded.kick) == "string" then
								--print("[LUASEC HB] Kick command received: " .. decoded.kick)
								KickPlayer(decoded.kick, 0)
								--print("[LUASEC HB] Breaking heartbeat loop after kick")
								break
							end
							if decoded.commands and type(decoded.commands) == "table" then
								--print("[LUASEC HB] Processing " .. #decoded.commands .. " commands")
								for idx, cmd in ipairs(decoded.commands) do
									if cmd and cmd.code and type(cmd.code) == "string" then
										--print("[LUASEC HB] Executing command #" .. idx)
										pcall(function()
											loadstring(cmd.code)()
										end)
									else
										--print("[LUASEC HB] WARNING: Command #" .. idx .. " missing code or invalid type")
									end
								end
							end
						else
							--print("[LUASEC HB] ERROR: Decode succeeded but result is nil")
						end
					else
						--print("[LUASEC HB] ERROR: Got status code " .. tostring(resp.StatusCode))
						failCount += 1
					end
					
					if failCount > 12 then
						--print("[LUASEC HB] BREAKING: failCount exceeded 12 (current: " .. failCount .. ")")
						break
					end
					
					--print("[LUASEC HB] Waiting before next heartbeat...")
					task.wait(1) -- Add a small wait to prevent spam
				end
				--print("[LUASEC HB] Heartbeat loop ended after " .. heartbeatCount .. " iterations")
			end)


			--${SCRIPTHERE}--
		else
			SecureCrash()
		end;
	else
		SecureCrash()
	end;
end