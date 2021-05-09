const net = require('net');
const parser = require('./parser');
const render = require('./render');
const images = require('images');

class Request {
  constructor(options) {
    this.method = options.method || "GET";
    this.host = options.host;
    this.port = options.port || 80;
    this.path = options.path || "/";
    this.body = options.body || {};
    this.headers = options.headers || {};
    // HTTP请求必须包含Content-Type头,用于确定如何解析body
    if (!this.headers["Content-Type"]) {
      this.headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    if (this.headers["Content-Type"] === "application/json") {
      this.bodyText = JSON.stringify(this.body);
    } else if (this.headers["Content-Type"] === "application/x-www-form-urlencoded") {
      this.bodyText = Object.keys(this.body).map(key => `${key}=${encodeURIComponent(this.body[key])}`).join('&');
    }
    // 请求体的长度
    this.headers["Content-Length"] = this.bodyText.length;
  }
  send(connection) {
    return new Promise((resolve,reject) => {
      const parser = new ResponseParser();
      // 如果传入连接，直接写入数据即可
      if (connection) {
        connection.write(this.toString());
      } else {
        // 否则我们创建一个connection
        connection = net.createConnection({
          host: this.host,
          port: this.port
        }, () => {
          // 创建完成连接之后写入数据
          connection.write(this.toString())
        })
      }
      // 监听数据的接收,传递给ResponseParser解析
      connection.on('data', (data) => {
        parser.receive(data.toString());
        if (parser.isFinished) {
          // 如果解析完成
          resolve(parser.response);
          connection.end();
        }
      });
      connection.on('error', (err) => {
        reject(err);
        connection.end();
      });
    });
  }
  // 将请求的数据组装成HTTP请求报文
  toString() {
    return `${this.method} ${this.path} HTTP/1.1\r
${Object.keys(this.headers).map(key => `${key}: ${this.headers[key]}`).join('\r\n')}\r
\r
${this.bodyText}`
  }
}

class ResponseParser {
  constructor() {
    // 状态机
    this.WAITING_STATUS_LINE = 0;
    this.WAITING_STATUS_LINE_END = 1;
    this.WAITING_HEADER_NAME = 2;
    this.WAITING_HEADER_SPACE = 3;
    this.WAITING_HEADER_VALUE = 4;
    this.WAITING_HEADER_LINE_END = 5;
    this.WAITING_HEADER_BLOCK_END = 6;
    this.WAITING_BODY = 7;
    
    // 指向当前状态
    this.current = this.WAITING_STATUS_LINE;
    this.statusLine = "";
    this.headers = {};
    this.headerName = "";
    this.headerValue = "";
    this.bodyParser = null;
    this.isFinished = false;
    this.response = {};
  }
  get isFinished(){
    return this.bodyParser && this.bodyParser.isFinished;
  }

  get response(){
    this.statusLine.match(/HTTP\/1.1 ([0-9]+) ([\s\S]+)/);
    return {
        statusCode: RegExp.$1,//正则对象上也存在匹配的结果
        statusText: RegExp.$2,
        headers: this.headers,
        body: this.bodyParser.content.join('')
    }
  }
  receive(string) {
    for (let i = 0; i < string.length; i++) {
      this.receiveChar(string.charAt(i));
      if (this.isFinished) {
        break;
      }    
    }
  }
  receiveChar(char) {
    if (this.current === this.WAITING_STATUS_LINE) {
      // 如果遇到回车符，表示状态行将要结束
      if (char === '\r') {
        this.current = this.WAITING_STATUS_LINE_END;
      } else {
        // 拼接保存状态行的字符
        this.statusLine += char;
      }
    // 状态行结束标识查找
    } else if (this.current === this.WAITING_STATUS_LINE_END) {
      // 如果状态行结束了，我们下一个要查找的时header的name
      if (char === '\n') {
        this.current = this.WAITING_HEADER_NAME;
      }
    // header name的查找
    } else if (this.current === this.WAITING_HEADER_NAME) {
      if (char === ':') {
        this.current = this.WAITING_HEADER_SPACE;
      } else if (char === '\r') {
        // 回车符说明所有的header name已查找完了
        this.current = this.WAITING_HEADER_BLOCK_END;
        if (this.headers['Transfer-Encoding'] === 'chunked') {
          this.bodyParser = new TrunkedBodyParser();
        }
      } else {
        this.headerName += char;
      }
    } else if (this.current === this.WAITING_HEADER_SPACE) {
      if (char === ' ') {
        this.current = this.WAITING_HEADER_VALUE;
      }
    } else if (this.current === this.WAITING_HEADER_VALUE) {
      if (char === '\r') {
        this.current = this.WAITING_HEADER_LINE_END;
        this.headers[this.headerName] = this.headerValue;
        this.headerName = "";
        this.headerValue = "";
      } else {
        this.headerValue += char;
      }
    } else if (this.current === this.WAITING_HEADER_LINE_END) {
      if (char === '\n') {
        this.current = this.WAITING_HEADER_NAME;
      }
    } else if (this.current === this.WAITING_HEADER_BLOCK_END) {
      if (char === '\n') {
        this.current = this.WAITING_BODY;
      }
    } else if (this.current === this.WAITING_BODY) {
      this.bodyParser.receiveChar(char);
      if (this.bodyParser.isFinished) {
        this.isFinished = true;
        this.response.body = this.bodyParser.content.join("");
      }
    }
  }
}

class TrunkedBodyParser {
  constructor() {
    this.WAITING_LENGTH = 0;
    this.WAITING_LENGTH_LINE_HEAD = 1;
    this.READING_TRUNK = 2;
    this.WAITING_NEW_LINE = 3;
    this.WAITING_NEW_LINE_END = 4;
    this.length = 0;
    this.content = [];
    this.isFinished = false;
    this.current = this.WAITING_LENGTH;
  }
  receiveChar(char) {
    if (this.current === this.WAITING_LENGTH) {
      if (char === '\r') {
        if (this.length === 0) {
          this.isFinished = true;
          return;
        }
        this.current = this.WAITING_LENGTH_LINE_HEAD;
      } else {
        this.length *= 16;
        this.length += parseInt(char, 16);
      }
    } else if (this.current === this.WAITING_LENGTH_LINE_HEAD) {
      if (char === '\n') {
        this.current = this.READING_TRUNK;
      }
    } else if (this.current === this.READING_TRUNK) {
      this.content.push(char);
      this.length--;
      if (this.length === 0) {
        this.current = this.WAITING_NEW_LINE;
      }
    } else if (this.current === this.WAITING_NEW_LINE) {
      if (char === '\r') {
        this.current = this.WAITING_NEW_LINE_END;
      }
    } else if (this.current === this.WAITING_NEW_LINE_END) {
      if (char === '\n') {
        this.current = this.WAITING_LENGTH;
      }
    }
  }
}


void async function () {
  const request = new Request({
    method: "POST",
    host: "127.0.0.1",
    port: "8088",
    path: "/",
    headers: {
      ["X-Foo2"]: "customed"
    },
    body: {
      name: "Mmmmle"
    }
  });
  const response = await request.send();
  const dom = parser.parseHTML(response.body);
  let viewport = images(800, 600);

  render(viewport,dom);
  console.log(JSON.stringify(dom, null, "   "));
}();