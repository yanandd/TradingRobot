var _prices = []
var _ticks
var _board
var _executions
//toLocaleString('en-US')
$(function () {

  initView();
  readData('ticker');
  readData('board')
  readData('executions')
  var ticks = []
  var numTick = 0
  var loop = function () {
    var price = {}
    var tick = getTick(numTick)
    price.Price = tick.ltp
    ticks.push()
    if (numTick < 1000)
      setTimeout(loop, 300)

  }
  //setTimeout(loop,200)
})


function readData(filename) {
  //保存一个json文件访问的URL作为一个变量
  let requestURL = 'data/' +filename +'.json';
  //创建一个HTTP请求对象
  let request = new XMLHttpRequest();
  //使用open（）打开一个新请求
  request.open('GET', requestURL);
  //设置XHR访问JSON格式数据，然后发送请求
  // request.responseType = 'json';
  //设置XHR访问text格式数据
  request.responseType = 'text';
  request.send();
  request.onload = function () {
    //处理来自服务器的数据  
    let JsonText = request.response;
    if (filename == 'ticker')
      tickProcess(JSON.parse(JsonText))
    if (filename == 'board')
      boardProcess(JSON.parse(JsonText))
    if (filename == 'executions')
      executionsProcess(JSON.parse(JsonText))
  }
}

function tickProcess(data){
  _ticks = data


}
function boardProcess(data){
  _board = data
}
function executionsProcess(data){
  _executions = data
  //_prices = pick(_executions,'price')
  _prices = _executions.map(function(item) {return item.price;});

}

function pick(arry, itemKey) {
  var arry2 = [];
  arry.map(((item, index) => {
    arry2.push(Object.assign({}, { itemKey: item[itemKey] }))
  }))
  return arry2
}

function initView() {
    var bth = new Vue({
    el: "#btn",
    methods: { }
  })

  var reset = new Vue({
    el: "#btnReset",
    methods: {
    }
  })


}