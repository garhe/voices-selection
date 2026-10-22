export function parseAzureEndpoint(value: string): { endpoint: string; deployment?: string } {
  if (!URL.canParse(value.trim())) throw new Error('Enter an HTTPS Azure resource address or a Foundry Realtime WebSocket URL.');
  const url = new URL(value.trim());
  if (!['https:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('Use an HTTPS resource address or secure WebSocket (wss) URL, without embedded credentials or a fragment.');
  if (!/\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/.test(url.hostname))
    throw new Error('Use a public Azure OpenAI resource hostname for the Azure endpoint.');
  const realtime = url.pathname === '/openai/v1/realtime';
  if (!['', '/'].includes(url.pathname) && !realtime)
    throw new Error('Use the resource address or the Foundry /openai/v1/realtime URL, not a project URL or another API path.');
  const deployments = url.searchParams.getAll('model');
  if (url.search && (!realtime || [...url.searchParams.keys()].some(key => key !== 'model') ||
    deployments.length !== 1 || !/^[a-zA-Z0-9._-]{1,120}$/.test(deployments[0])))
    throw new Error('The Realtime URL may contain only one model deployment parameter. Enter API keys in the separate key field.');
  url.protocol = 'https:';
  return { endpoint: url.origin, deployment: deployments[0] };
}
