require("./index.js");
const http = require('http');

// This is specifically for repl so that this program can get pinged and kept awake 24/7
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
});
server.listen(3000);