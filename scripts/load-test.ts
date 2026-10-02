import autocannon from 'autocannon';

const url = process.env.BASE_URL || 'http://127.0.0.1:3000/api/health';
const connections = Number(process.env.CONNECTIONS || 50);
const duration = Number(process.env.DURATION || 30);
const result = await autocannon({ url, connections, duration, pipelining: 1 });
console.log(JSON.stringify({ url, connections, duration, requests: result.requests, latency: result.latency, errors: result.errors, non2xx: result.non2xx }, null, 2));