var http = require("http");
var url = require("url");
var fs = require("fs"); 
var path = require("path"); 

function start(route, handle) {
  function onRequest(request, response) {
	var pathname = url.parse(request.url).pathname;
    var ext = pathname.match(/(\.[^.]+|)$/)[0];//取得后缀名
    console.log("Request for " + pathname + " received.");

	if (request.method == "GET") {
		switch(ext){
            case ".css":
            case ".js":
                fs.readFile("."+request.url, 'utf-8',function (err, data) {//读取内容
                    if (err) throw err;
                    response.writeHead(200, {
                        "Content-Type": {
                             ".css":"text/css",
                             ".js":"application/javascript",
                      }[ext]
                    });
                    response.write(data);
                    response.end();
                });
                break;
            default:
				fs.readFile('./index.html', 'utf-8',function (err, data) {//读取内容
                    if (err) throw err;
                    response.writeHead(200, {
                        "Content-Type": "text/html"
                    });
                    response.write(data);
                    response.end();
                });
		}
    }
	if (request.method === "POST") {
		route(handle, pathname, response, request);
	}
  }

  http.createServer(onRequest).listen(process.env.PORT || 8080);
  console.log("Server has started.");
}

exports.start = start;
