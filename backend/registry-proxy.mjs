import net from "node:net";

const listenHost = process.env.REGISTRY_PROXY_HOST || "127.0.0.1";
const listenPort = Number(process.env.REGISTRY_PROXY_PORT || 5002);
const targetHost = process.env.REGISTRY_PROXY_TARGET_HOST || "127.0.0.1";
const targetPort = Number(process.env.REGISTRY_PROXY_TARGET_PORT || 5001);

const server = net.createServer((client) => {
  const upstream = net.createConnection({ host: targetHost, port: targetPort });
  client.setKeepAlive(true);
  upstream.setKeepAlive(true);
  client.pipe(upstream);
  upstream.pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", close);
});

server.on("error", (error) => {
  console.error(`[registry-proxy] ${error.message}`);
  process.exitCode = 1;
});

server.listen(listenPort, listenHost, () => {
  console.log(`[registry-proxy] tcp://${listenHost}:${listenPort} -> tcp://${targetHost}:${targetPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
