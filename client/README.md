# Luasec Client Requirements

- Keep using the same encryption and encoding for requests.
- Make sure your variable names in the encrypted body match what the server expects.
- You can change anything else for security, as long as it still works with the server.


Make sure the client scripts don't deviate from this workflow:

1. **User loads the script**  
   The user calls `/loader/:serverid/:scriptid` and runs it with `loadstring`.  
   This script (from `loader.lua`) fetches the main script from the `/script` endpoint, sending their Key, ScriptId, and ServerId in the request body.

2. **Main script execution**  
   The main script is also run with `loadstring`.  
   It then calls the `/validate` endpoint, sending:
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

3. **Server-side validation**  
   The server checks if the user is allowed to use the script.  
   If valid, the server returns the 5 RNG values after processing them through an algebraic function.

4. **Client-side verification**  
   The client applies the inverse function to the returned values.  
   If the result matches the original RNGs, and everything else checks out, the source code is executed.
