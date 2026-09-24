getgenv().Key = "${USERKEY}"

_G.SCRIPTNAME = "${SCRIPTNAME}"
_G.LUASECNOTILIB = loadstring(game:HttpGet(('https://cdn.luasec.net/notis.lua'),true))()
_G.LUASECNOTILIB.prompt(_G.SCRIPTNAME, 'Loader initialized! Please wait...', 3)


--// Luasec Loader -- Json lib \\--
local Json={_version="0.1"}local Encode;local escape_char_map={["\\"]="\\",['"']='"',["\b"]="b",["\f"]="f",["\n"]="n",["\r"]="r",["\t"]="t"}local escape_char_map_inv={["/"]="/"}for k,v in pairs(escape_char_map)do escape_char_map_inv[v]=k end;local function escape_char(c)return"\\"..(escape_char_map[c]or string.format("u%04x",c:byte()))end;local function Encode_nil(val)return"null"end;local function Encode_table(val,stack)local res={}stack=stack or{}if stack[val]then error("circular reference")end;stack[val]=true;if rawget(val,1)~=nil or next(val)==nil then local n=0;for k in pairs(val)do if type(k)~="number"then error("invalid table: mixed or invalid key types")end;n=n+1 end;if n~=#val then error("invalid table: sparse array")end;for i,v in ipairs(val)do table.insert(res,Encode(v,stack))end;stack[val]=nil;return"["..table.concat(res,",").."]"else for k,v in pairs(val)do if type(k)~="string"then error("invalid table: mixed or invalid key types")end;table.insert(res,Encode(k,stack)..":"..Encode(v,stack))end;stack[val]=nil;return"{"..table.concat(res,",").."}"end end;local function Encode_string(val)return'"'..val:gsub('[%z\1-\31\\"]',escape_char)..'"'end;local function Encode_number(val)if val~=val or val<=-math.huge or val>=math.huge then error("unexpected number value '"..tostring(val).."'")end;return string.format("%.14g",val)end;local type_func_map={["nil"]=Encode_nil,["table"]=Encode_table,["string"]=Encode_string,["number"]=Encode_number,["boolean"]=tostring}Encode=function(val,stack)local t=type(val)local f=type_func_map[t]if f then return f(val,stack)end;error("unexpected type '"..t.."'")end;function Json.Encode(val)return(Encode(val))end;local parse;local function create_set(...)local res={}for i=1,select("#",...)do res[select(i,...)]=true end;return res end;local space_chars=create_set(" ","\t","\r","\n")local delim_chars=create_set(" ","\t","\r","\n","]","}",",")local escape_chars=create_set("\\","/",'"',"b","f","n","r","t","u")local literals=create_set("true","false","null")local literal_map={["true"]=true,["false"]=false,["null"]=nil}local function next_char(str,idx,set,negate)for i=idx,#str do if set[str:sub(i,i)]~=negate then return i end end;return#str+1 end;local function Decode_error(str,idx,msg)local line_count=1;local col_count=1;for i=1,idx-1 do col_count=col_count+1;if str:sub(i,i)=="\n"then line_count=line_count+1;col_count=1 end end;error(string.format("%s at line %d col %d",msg,line_count,col_count))end;local function codepoint_to_utf8(n)local f=math.floor;if n<=127 then return string.char(n)elseif n<=2047 then return string.char(f(n/64)+192,n%64+128)elseif n<=65535 then return string.char(f(n/4096)+224,f(n%4096/64)+128,n%64+128)elseif n<=1114111 then return string.char(f(n/262144)+240,f(n%262144/4096)+128,f(n%4096/64)+128,n%64+128)end;error(string.format("invalid unicode codepoint '%x'",n))end;local function parse_unicode_escape(s)local n1=tonumber(s:sub(1,4),16)local n2=tonumber(s:sub(7,10),16)if n2 then return codepoint_to_utf8((n1-55296)*1024+(n2-56320)+65536)else return codepoint_to_utf8(n1)end end;local function parse_string(str,i)local res=""local j=i+1;local k=j;while j<=#str do local x=str:byte(j)if x<32 then Decode_error(str,j,"control character in string")elseif x==92 then res=res..str:sub(k,j-1)j=j+1;local c=str:sub(j,j)if c=="u"then local hex=str:match("^[dD][89aAbB]%x%x\\u%x%x%x%x",j+1)or str:match("^%x%x%x%x",j+1)or Decode_error(str,j-1,"invalid unicode escape in string")res=res..parse_unicode_escape(hex)j=j+#hex else if not escape_chars[c]then Decode_error(str,j-1,"invalid escape char '"..c.."' in string")end;res=res..escape_char_map_inv[c]end;k=j+1 elseif x==34 then res=res..str:sub(k,j-1)return res,j+1 end;j=j+1 end;Decode_error(str,i,"expected closing quote for string")end;local function parse_number(str,i)local x=next_char(str,i,delim_chars)local s=str:sub(i,x-1)local n=tonumber(s)if not n then Decode_error(str,i,"invalid number '"..s.."'")end;return n,x end;local function parse_literal(str,i)local x=next_char(str,i,delim_chars)local word=str:sub(i,x-1)if not literals[word]then Decode_error(str,i,"invalid literal '"..word.."'")end;return literal_map[word],x end;local function parse_array(str,i)local res={}local n=1;i=i+1;while 1 do local x;i=next_char(str,i,space_chars,true)if str:sub(i,i)=="]"then i=i+1;break end;x,i=parse(str,i)res[n]=x;n=n+1;i=next_char(str,i,space_chars,true)local chr=str:sub(i,i)i=i+1;if chr=="]"then break end;if chr~=","then Decode_error(str,i,"expected ']' or ','")end end;return res,i end;local function parse_object(str,i)local res={}i=i+1;while 1 do local key,val;i=next_char(str,i,space_chars,true)if str:sub(i,i)=="}"then i=i+1;break end;if str:sub(i,i)~='"'then Decode_error(str,i,"expected string for key")end;key,i=parse(str,i)i=next_char(str,i,space_chars,true)if str:sub(i,i)~=":"then Decode_error(str,i,"expected ':' after key")end;i=next_char(str,i+1,space_chars,true)val,i=parse(str,i)res[key]=val;i=next_char(str,i,space_chars,true)local chr=str:sub(i,i)i=i+1;if chr=="}"then break end;if chr~=","then Decode_error(str,i,"expected '}' or ','")end end;return res,i end;local char_func_map={['"']=parse_string,["0"]=parse_number,["1"]=parse_number,["2"]=parse_number,["3"]=parse_number,["4"]=parse_number,["5"]=parse_number,["6"]=parse_number,["7"]=parse_number,["8"]=parse_number,["9"]=parse_number,["-"]=parse_number,["t"]=parse_literal,["f"]=parse_literal,["n"]=parse_literal,["["]=parse_array,["{"]=parse_object}parse=function(str,idx)local chr=str:sub(idx,idx)local f=char_func_map[chr]if f then return f(str,idx)end;Decode_error(str,idx,"unexpected character '"..chr.."'")end;function Json.Decode(str)if type(str)~="string"then error("expected argument of type string, got "..type(str))end;local res,idx=parse(str,next_char(str,1,space_chars,true))idx=next_char(str,idx,space_chars,true)if idx<=#str then Decode_error(str,idx,"trailing garbage")end;return res end

--// Locals
local LoaderVersion = 0.1 -- Add Server Side Support For This
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

local Find = ("").find 	-- Stops basic env loggers
local Char = ("").char
local Byte = ("").byte

AuthTime = tick()

--// Helper Functions \\--
local function SecureCrash()
	-- print("Crashing (loader)")
	-- print(debug.traceback())

	if NfCrash then
		NfCrash()
	else
		while true do end
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

--// Checks \\--


if getgenv().Luasec and Luasec and _G.Luasec then return end
getgenv().Luasec = true; Luasec = true; _G.Luasec = true
JumpCounter = JumpCounter + 1
if not Key then return KickPlayer("Script Key Not Set.", 0) end
JumpCounter = JumpCounter + 1
if #Key ~= 24 then return KickPlayer("Incorrect Key", 0) end
loadstring("return function() end")()
JumpCounter = JumpCounter + 1
if game:GetService("RunService"):IsStudio() then return SecureCrash() end

--// General script protection \\--

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
-- for Name, Value in pairs(getgenv()) do
--     if type(Value) == "function" then
--         local Info = debug.getinfo(Value)
--         if Info.currentline ~= -1 then
--             SecureCrash()
-- 			return
--         end
--     end
-- end

for i,v in pairs(getgenv()) do
    if type(v) == "function" then
        if isfunctionhooked(v) then 
           SecureCrash()
		   return
        end
    end
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

--// Super Request


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

local RawBody = Json.Encode({
    Key = Key,
    ServerId = ServerId,
    ScriptId = ScriptId,
	LoaderVersion = LoaderVersion,
	ShouldBlacklist = ShouldBlacklist,
})

local Encrypted = Xor(RawBody, "${key}")
local Data = "${key}" .. Base64(Encrypted)
local ByteArray = {}

for i = 1, #Data do
    table.insert(ByteArray, Byte(Data, i))
end


local Body = Json.Encode({Data = ByteArray})

			-- [1] = "Headers",
			-- [2] = "Url", 
			-- [3] = "Method",
			-- [4] = "Body"
			
local Response = HttpRequest({
		Headers = {
			["Content-Type"] = "application/json",
		},
		Url = "https://auth.luasec.net/script/",
		Method = "POST",
		Body = Body,
})


if SecureEQ(Response.StatusCode, 403) and Response.StatusCode == 403 then
	local errorMsg = Response.Body and Response.Body ~= "" and Response.Body or "Failed to authenticate."
	return KickPlayer(errorMsg, 1)
end

if SecureEQ(Response.StatusCode, 200) and Response.StatusCode == 200 then
	local Data1 = Json.Decode(Response.Body)
	JumpCounter = JumpCounter + 1
	if SecureEQ(Data1.Valid, true) and Data1.Valid == true then
		JumpCounter = JumpCounter + 1
		if not SecureEQ(JumpCounter, 5) and JumpCounter ~= 5 then
			spawn(function()
				task.wait(math.random(4, 7))
				SecureCrash()
				return
			end)
			SecureCrash()
			return
		end
		loadstring(Data1.Body)()
	else
		return SecureCrash()
	end
end

