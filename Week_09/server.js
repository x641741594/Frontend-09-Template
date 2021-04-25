const http = require('http')
http.createServer((req,res)=>{
  let body = [];
  req.on('error',(err)=>{
    console.error(err);
  }).on('data',(chunk)=>{
    body.push(chunk.toString())
  }).on('end',()=>{
    body = Buffer.concat(body).toString();
            console.log("Body: ", body);
            response.writeHead(200, {"Content-Type": "text/plain"});
            response.end(`
          <html maaa=a>
          <head>
            <style>
              body div #myid{
                width:100px;
                background-color: #ff5000;
              }
              body div img{
                width: 30px;
                background-color:#ff1111;
              }
            </style>
          </head>
          <body>
              
          </body>
        `);
  })
}).listen(8080);
console.log('server started');