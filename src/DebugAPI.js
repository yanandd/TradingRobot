const BigNumber = require('bignumber.js');
const path = require('path');
const ConfigManager = require('./ConfigManager');
const configManager = new ConfigManager(path.join(__dirname, '../'));
const CONFIG = configManager.load();
const LEVER = CONFIG.collateralLever
var orderList = []
var RequireJPY = BigNumber(0)
var CollateralJPY = BigNumber(0)
var OpenProfit = BigNumber(0)
var execOrderList = []
var orderID = 0
exports.init = function(){
    CollateralJPY = BigNumber(90000)
}

exports.sendOrder = function (side, size, price) {
  //检查既存订单
  try {
    size = BigNumber(size)
    price = BigNumber(price)
    if (orderList.length == 0) {
      orderID++
      var order = { id: orderID, side: side, size: size, price: price }
      orderList.push(order)
      RequireJPY = size.multipliedBy(BigNumber(price)).idiv(LEVER)
    } else if (side == orderList[0].side) {
      //已经有订单的情况
      // 1，判断side
      orderID++
      var order = { id: orderID, side: side, size: size, price: price }
      orderList.push(order)
      RequireJPY = RequireJPY.plus(size.multipliedBy(BigNumber(price)).idiv(LEVER))
    } else if (side != orderList[0].side) {
      var symbol = 1
      if (orderList[0].side == 'SELL') {
        symbol = -1
      }
      
      orderList.every((el, i) => {
        //console.log('size:' + size.toFixed(6) + ' orderSize:', el.size.toFixed(6))
        if (el.size.isLessThanOrEqualTo(size)) {
          // var execOrder = { side1: el.side, size: el.size, price1: el.price, side2: side, price2: price }
          // execOrderList.push(execOrder)
          var diffProfit = el.size.multipliedBy(price).minus(el.size.multipliedBy(el.price)).multipliedBy(symbol)
          CollateralJPY = CollateralJPY.plus(diffProfit)
          RequireJPY = RequireJPY.minus(el.size.multipliedBy(el.price).idiv(LEVER))
          size = size.minus(el.size)
          delete orderList[i]
          if (size.comparedTo(0) == 0) {
            return false
          }          
          return true
        }
        if (el.size.isGreaterThan(size)) {
          var execOrder = { side1: el.side, size: size, price1: el.price, side2: side, price2: price }
          execOrderList.push(execOrder)
          var diffProfit = size.multipliedBy(price).minus(size.multipliedBy(el.price)).multipliedBy(symbol)
          CollateralJPY = CollateralJPY.plus(diffProfit)
          RequireJPY = RequireJPY.minus(size.multipliedBy(el.price).idiv(LEVER))
          el.size = el.size.minus(size)
          size = BigNumber(0)
        }
      })
      if (size.isGreaterThan(0)) {
        orderID++
        var order = { id: orderID, side: side, size: size, price: price }
        orderList.push(order)
        RequireJPY = RequireJPY.plus(size.multipliedBy(BigNumber(price)).idiv(LEVER))
      }
    }
    // 去掉被删除的仍然占位的数组元素
    orderList = orderList.filter(el=>el)
    return orderID
  } catch (err) {
    console.log(err)
    throw 'sendOrder Error,side,size,price：' + side + ',' + size.toFixed(6) + ',' + price.toFixed(6)
  }

}

exports.getProfit = function (currentPrice) {
    var symbol = 1    
    OpenProfit = BigNumber(0)
    if(orderList.length > 0  && currentPrice){
      if (orderList[0].side == 'SELL'){
        symbol = -1
      }
      orderList.forEach((el)=>{
        OpenProfit = OpenProfit.plus(BigNumber(currentPrice).minus(el.price).multipliedBy(el.size).multipliedBy(symbol))
      })
    }
    return OpenProfit;
  }

exports.getCollateral = function() {
  return {
    require_JPY:RequireJPY,
    JPY:CollateralJPY,
    open_profit:OpenProfit
  }
}

exports.getPosition = function() {
  return orderList;
}