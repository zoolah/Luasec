require("dotenv").config();
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const fetch = require("node-fetch");

const API_KEY = process.env.WYN_API_KEY || "wynf_your_api_key";
const API_BASE = "https://wynfuscate.com/api/v1";
const CACHE_DIR = path.resolve("./wyn_cache");


const DEFAULT_OPTIONS = {
  securityTier: "STANDARD",
  targetPlatform: "ROBLOX",
  enhancedCompression: false,

  node: "STABLE",

  autoApplyJitMacros: false,  
  optimizeSource: false,     
  reviewOptimizations: false,  
};


async function pollJob(jobId) {
  let intervalMs = 2000;
  const maxIntervalMs = 30000;
  const maxPolls = 60;

  for (let i = 0; i < maxPolls; i++) {
    const res = await fetch(`${API_BASE}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    if (!res.ok) {
      throw new Error(`Poll failed: ${res.status} ${await res.text()}`);
    }

    const job = await res.json();
    if (job.status === "completed") return job;
    if (job.status === "failed") {
      throw new Error(`Job failed: ${job.error?.message ?? JSON.stringify(job)}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
    intervalMs = Math.min(intervalMs * 1.5, maxIntervalMs);
  }

  throw new Error(`Job ${jobId} timed out`);
}

function generateRandom9LetterString() {
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < 9; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
      }
      return result;
};

async function obfuscateText(luaScript, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };


  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const timestamp = Date.now();
  const inputFile = path.join(CACHE_DIR, `input_${timestamp}.lua`);
  fs.writeFileSync(inputFile, luaScript, "utf8");

  const form = new FormData();
  form.append("file", fs.createReadStream(inputFile), {
    filename: "script.lua",
    contentType: "text/plain",
  });
  form.append("targetPlatform", "ROBLOX");
  form.append("securityTier", "STANDARD");
  form.append("node", "STABLE");
  form.append("enhancedCompression", "false");


  form.append("autoApplyJitMacros", "true");
  form.append("optimizeSource", "true");



  const submitRes = await fetch(`${API_BASE}/obfuscate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!submitRes.ok) {
    throw new Error(`Submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }

  const submitData = await submitRes.json();

  const job_id = submitData.id ?? submitData.job_id ?? submitData.jobId ?? submitData.job?.id;
  if (!job_id) {
    throw new Error(`Could not find job ID in response: ${JSON.stringify(submitData)}`);
  }

  await pollJob(job_id);

  const downloadRes = await fetch(`${API_BASE}/jobs/${job_id}/download`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!downloadRes.ok) {
    throw new Error(`Download failed: ${downloadRes.status} ${await downloadRes.text()}`);
  }

  const obfuscatedCode = await downloadRes.text();

  const outputFile = path.join(CACHE_DIR, `output_${timestamp}.lua`);
  fs.writeFileSync(outputFile, obfuscatedCode, "utf8");


  try {
    await fetch(`${API_BASE}/jobs/${job_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
  } catch (e) {
    console.warn(`[wyn] Could not delete job ${job_id}:`, e.message);
  }


  // fs.unlinkSync(inputFile);
  // fs.unlinkSync(outputFile);


  return obfuscatedCode.replace("-- Protected by wYnFuscate: https://wynfuscate.com | https://discord.gg/Z5xQ47Mbnd", "").trim();
}


async function obfuscateMainScript(originalPath, metadata = null, serverId, scriptId, scriptName) {

        const {
            hwid,
            unix_expiration,
            username,
            lifetime,
            usageCount,
            last_reset,
            userId
        } = metadata;

        const originalCode = fs.readFileSync(originalPath, "utf-8");
        const templateCode = fs.readFileSync(
            path.join(__dirname, "client", "main.lua"),
            "utf-8"
        );



        const processedCode = (templateCode
            .replace("--${SCRIPTHERE}--", originalCode)
            .replace("${SCRIPTID}", scriptId)
            .replace("${SERVERID}", serverId)
            .replace("${SCRIPTNAME}", scriptName)
            .replace("--RND1--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND2--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND3--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND4--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND5--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND6--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND7--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND8--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND9--", Math.floor(Math.random() * 10000) + 1)
            .replace("--RND10--", Math.floor(Math.random() * 10000) + 1)
            .replaceAll('${key}', generateRandom9LetterString()));




        const obfuscatedCode = await obfuscateText(processedCode, {
            securityTier: "STANDARD",
            targetPlatform: "ROBLOX",
            node: "STABLE",
        })



        return obfuscatedCode;
};

module.exports = { obfuscateText, DEFAULT_OPTIONS, obfuscateMainScript };
