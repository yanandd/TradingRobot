const BigNumber = require('bignumber.js');
const ConfigManager = new ConfigManager(path.join(__dirname, '../'));
const Config = ConfigManager.load();
const LEVER = Config.collateralLever
var orderList = []
var RequireJPY = BigNumber(0)
var CollateralJPY = BigNumber(0)
var OpenProfit = BigNumber(0)
var execOrderList = []
var orderID = 0
exports.init = function(){
    CollateralJPY = BigNumber(90000)
}

exports.sendOrder = function (side, size, price)  {
    //检查既存订单
    if (orderList.length == 0){
        orderID++
        var order = {id:orderID,side:side,size:size,price:price}
        orderList.push(order)
        RequireJPY = BigNumber(size).multipliedBy(BigNumber(price)).idiv(LEVER)
        return orderID
    }
    //已经有订单的情况
    // 1，判断side
    var oldOrder = orderList[0]
    if (side == oldOrder.side){
        orderID++
        var order = {id:orderID,side:side,size:size,price:price}
        orderList.push(order)
        RequireJPY = RequireJPY.plus(BigNumber(size).multipliedBy(BigNumber(price)).idiv(LEVER))
        return orderID
    }
    var symbol = 1
    if (side != oldOrder.side){
        if (oldOrder.side == 'SELL'){
            symbol = -1
        }
        for (var i=0;i<orderList.length;i++){
            if (orderList[i].size <= size){
                var OR = orderList.shift()
                execOrderList.push(JSON.parse(JSON.stringify(OR)))
                //TODO 此处应该考虑受注オーダー番号
                var diffProfit =  BigNumber(OR.size).multipliedBy(price).minus(BigNumber(OR.size).multipliedBy(OR.price)).multipliedBy(symbol)
                CollateralJPY = CollateralJPY.plus(diffProfit)
                RequireJPY = RequireJPY.minus(BigNumber(OR.size).multipliedBy(OR.price).idiv(LEVER))
                size -= OR.size
                if (size == 0){
                    break
                }
                continue
            }
            if (orderList[i].size > size){
                var OR = orderList[i]
                var diffProfit =  BigNumber(size).multipliedBy(price).minus(BigNumber(size).multipliedBy(OR.price)).multipliedBy(symbol)
                CollateralJPY = CollateralJPY.plus(diffProfit)
                RequireJPY = RequireJPY.minus(BigNumber(size).multipliedBy(OR.price).idiv(LEVER))
                OR.size -= size
                size = 0
            }
        }
        if (size >=0 ){
            orderID++
            var order = {id:orderID,side:side,size:size,price:price}
            orderList.push(order)
            RequireJPY = RequireJPY.plus(BigNumber(size).multipliedBy(BigNumber(price)).idiv(LEVER))
            return orderID
        }
    }    
    
    throw 'sendOrder Error,side,size,price：' + side + ',' + size + ','  + price 
}

exports.calculateProfit = function (currentPrice) {
    let size = new BigNumber(0);
    let JPY = new BigNumber(0);
    let price = new BigNumber(0);
    var Require_JPY = new BigNumber(0)
    var sympol = 1
    var position = []
    if (this.debugPosition instanceof Array && this.debugPosition.length > 0) {
      var side = this.debugPosition[0].side
      this.debugPosition.forEach((pos) => {
        if (side == pos.side) {
          if (side == 'SELL') {
            sympol = -1
          }
          size = size.plus(BigNumber(pos.size))
          let value = BigNumber(pos.size).multipliedBy(pos.price)
          JPY = JPY.plus(value)
          price = JPY.idiv(size)
          Require_JPY = BigNumber(Require_JPY).plus(value).idiv(this.Lever)
          //this.debugCollateral.JPY = this.debugCollateral.JPY.minus(value.idiv(this.Lever))
        }
        if (side != pos.side && size.isGreaterThanOrEqualTo(pos.size)) {
          if (side == 'SELL') {
            sympol = -1
          }
          this.debugCollateral.JPY = this.debugCollateral.JPY.plus(BigNumber(pos.size).multipliedBy(BigNumber(pos.price).minus(price)).multipliedBy(sympol))
          size = size.minus(pos.size).abs()
          if (size.comparedTo(0) == 0) {
            price = BigNumber(0)
            Require_JPY = BigNumber(0)
          } else {
            // price 不变
            Require_JPY = size.multipliedBy(price).idiv(this.Lever)
          }
        } else if (side != pos.side && size.isLessThan(pos.size)) {
          throw 'position error'
        }
      })
      if (size.comparedTo(0) != 0) {
        position.push({ side: side, size: size, price: price })
      }
      else{
        position = []
      }
      this.debugCollateral.Require_JPY = Require_JPY
      this.debugPosition = position
    }
    
    if(position.length > 0  && currentPrice){
      this.debugCollateral.open_profit = BigNumber(currentPrice).minus(price).multipliedBy(size).multipliedBy(sympol)
    }else{
      this.debugCollateral.open_profit = BigNumber(0)
    }
  }