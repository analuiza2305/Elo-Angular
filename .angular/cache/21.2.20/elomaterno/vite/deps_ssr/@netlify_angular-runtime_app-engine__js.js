import { createRequire } from 'module';const require = createRequire(import.meta.url);
import "./chunk-S6STQDT5.js";

// node_modules/@netlify/angular-runtime/src/app-engine.js
import { env } from "process";
function getAllowedHosts() {
  const defaultAllowedHosts = [];
  if (env.NETLIFY_LOCAL === "true") {
    return defaultAllowedHosts;
  }
  let deployId;
  let deployPrimeUrlHostname;
  let siteId;
  let siteName;
  const environmentVariables = ["DEPLOY_ID", "DEPLOY_PRIME_URL", "DEPLOY_URL", "SITE_ID", "SITE_NAME", "URL"];
  for (const environmentVariable of environmentVariables) {
    switch (environmentVariable) {
      case "DEPLOY_ID":
        deployId = getEnvironmentVariable(environmentVariable);
        break;
      case "DEPLOY_PRIME_URL":
        deployPrimeUrlHostname = getHostnameFromEnvironmentVariable(environmentVariable);
        if (deployPrimeUrlHostname) {
          defaultAllowedHosts.push(deployPrimeUrlHostname);
        }
        break;
      case "DEPLOY_URL":
      case "URL": {
        const hostname = getHostnameFromEnvironmentVariable(environmentVariable);
        if (hostname) {
          defaultAllowedHosts.push(hostname);
        }
        break;
      }
      case "SITE_ID":
        siteId = getEnvironmentVariable(environmentVariable);
        if (siteId) {
          defaultAllowedHosts.push(`${siteId}.netlify.app`);
        }
        break;
      case "SITE_NAME":
        siteName = getEnvironmentVariable(environmentVariable);
        if (siteName) {
          defaultAllowedHosts.push(`${siteName}.netlify.app`);
        }
        break;
      default:
        break;
    }
  }
  if (deployPrimeUrlHostname?.includes("--") && siteId && siteName) {
    const [branchNameOrDpNumber] = deployPrimeUrlHostname.split("--");
    defaultAllowedHosts.push(`${branchNameOrDpNumber}--${siteName}.netlify.app`);
    defaultAllowedHosts.push(`${branchNameOrDpNumber}--${siteId}.netlify.app`);
  }
  if (deployId && siteId) {
    defaultAllowedHosts.push(`${deployId}--${siteId}.netlify.app`);
  }
  return [...new Set(defaultAllowedHosts)];
}
function getContext() {
  return typeof Netlify !== "undefined" ? Netlify?.context : void 0;
}
function getEnvironmentVariable(environmentVariable) {
  const value = env[environmentVariable];
  if (value == null || value === "" || value === "undefined") {
    console.warn(
      `Missing Netlify-specific environment variable ${environmentVariable}. \`allowedHosts\` config might be incomplete.`
    );
    return;
  }
  return value;
}
function getHostnameFromEnvironmentVariable(environmentVariable) {
  const value = getEnvironmentVariable(environmentVariable);
  if (value == null) {
    return;
  }
  try {
    return new URL(value).hostname;
  } catch {
    console.warn(`Netlify-specific environment variable ${environmentVariable} does not contain a valid URL`);
  }
}
function getTrustProxyHeaders() {
  return ["x-forwarded-for"];
}
export {
  getAllowedHosts,
  getContext,
  getTrustProxyHeaders
};
//# sourceMappingURL=@netlify_angular-runtime_app-engine__js.js.map
