const key = '4z1Hg1tWmRna6CHVk8ZSm6';
const secret = 'IroSHCJ9V6G23wIgVpBeKtBGRMtPj1EIUTGJM6iFwHw=';
const request = require('request-promise');
const crypto = require('crypto');

exports.getPosition = async function () {
    var timestamp = Date.now().toString();
    var method = 'GET';
    var path = '/v1/me/getpositions?product_code=FX_BTC_JPY';
    var text = timestamp + method + path;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');

    var options = {
        url: 'https://api.bitflyer.com' + path,
        method: method,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign
        }
    };
    var result = await request(options, function (err, response, payload) {
        if(err)
            console.log(err)
        return payload
    });
    return eval(result);
}

exports.getCollateral = function () {
    var timestamp = Date.now().toString();
    var method = 'GET';
    var path = '/v1/me/getcollateral?product_code=FX_BTC_JPY';
    var text = timestamp + method + path;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');

    var options = {
        url: 'https://api.bitflyer.com' + path,
        method: method,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign
        }
    };
    request(options, function (err, response, payload) {
        if(err)
            console.log(err)
        console.log(payload);
    });
}

exports.getHealth = async function() {
    var path = '/v1/gethealth';
    var query = '?product_code=FX_BTC_JPY';
    var url = 'https://api.bitflyer.com' + path + query;
    //console.log('check exchange status。。。。')    
    var result = await request(url, function (err, response, payload) {
        if (err)
            console.log(err)
        return
    });

    return result;
}

exports.getBalanceHistory = function(){
    var timestamp = Date.now().toString();
    var method = 'GET';
    var path = '/v1/me/getbalancehistory';
    var text = timestamp + method + path;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');

    var options = {
        url: 'https://api.bitflyer.com?currency_code=JPY&count=100' + path,
        method: method,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign
        }
    };
    request(options, function (err, response, payload) {
        console.log(payload);
    });
}

exports.sendOrder = async function (orderInfo){
    var timestamp = Date.now().toString();
    var method = 'POST';
    var path = '/v1/me/sendchildorder';
    var body = JSON.stringify(orderInfo);

    var text = timestamp + method + path + body;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');

    var options = {
        url: 'https://api.bitflyer.com' + path,
        method: method,
        body: body,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign,
            'Content-Type': 'application/json'
        }
    };
    var result = await request(options, function (err, response, payload) {
        if (err){
            if (response.statusCode != 200)
            return err
        }
        return payload
    });
    return  result
}

exports.getOrders = async function(){
    var timestamp = Date.now().toString();
    var method = 'GET';
    var path = '/v1/me/getchildorders?product_code=FX_BTC_JPY&child_order_state=ACTIVE';
    var text = timestamp + method + path;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');
    
    var options = {
        url: 'https://api.bitflyer.com' + path,
        method: method,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign
        }
    };
    var result 
    await request(options, function (err, response, payload) {
        if (err){
            result = { status:'error',data:err}
            return
        }
        result = {status:'OK',data:eval(payload)}
        return
    });
    
    return  result
}

exports.confirmOrder = async function(orderID){
    var timestamp = Date.now().toString();
    var method = 'GET';
    var param = orderID? 'child_order_acceptance_id=' + orderID + '&' :''
    var path = '/v1/me/getexecutions?' + param + 'product_code=FX_BTC_JPY';
    var text = timestamp + method + path;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');

    var options = {
        url: 'https://api.bitflyer.com' + path,
        method: method,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign
        }
    };
    var result 
    await request(options, function (err, response, payload) {
        if (err){
            result = { status:'error',data:err}
            return
        }
        result = {status:'OK',data:eval(payload)}
        return
    });
    
    return  result
}

exports.cancelOrder = async function(orderID){
    var timestamp = Date.now().toString();
    var method = 'POST';
    var path = '/v1/me/cancelchildorder';
    var body = JSON.stringify({
    product_code: "FX_BTC_JPY",
    child_order_id: orderID
    });

    var text = timestamp + method + path + body;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');

    var options = {
        url: 'https://api.bitflyer.com' + path,
        method: method,
        body: body,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign,
            'Content-Type': 'application/json'
        }
    };
    var result 
    await request(options, function (err, response, payload) {
        if (err){
            result = { status:'error',data:err}
            return
        }
        result = {status:'OK',data:eval(payload)}
        return
    });
    
    return  result
}

exports.getCollateral = async function(){
    var timestamp = Date.now().toString();
    var method = 'GET';
    var path = '/v1/me/getcollateral';
    var text = timestamp + method + path;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');
    
    var options = {
        url: 'https://api.bitflyer.com' + path,
        method: method,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign
        }
    };
    //{"collateral":190207.000000000000,"open_position_pnl":-10347.980780000000000000000000,"require_collateral":182137.03500000000,"keep_rate":0.9874928469105692864715844309}
    var res = await request(options, function (err, response, payload) {
        if (err)
            return false
        return payload
    });
    res = JSON.parse(res)
    var result = {
        JPY:res.collateral,
        open_profit:res.open_position_pnl,
        require_JPY:res.require_collateral,
        keep_rate:res.keep_rate
    }
    return result;
}

exports.getCollateralBalance = async function(){
    var timestamp = Date.now().toString();
    var method = 'GET';
    var path = '/v1/me/getcollateralaccounts';
    var text = timestamp + method + path;
    var sign = crypto.createHmac('sha256', secret).update(text).digest('hex');

    var options = {
        url: 'https://api.bitflyer.com' + path,
        method: method,
        headers: {
            'ACCESS-KEY': key,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': sign
        }
    };
    // [  {
    //       "currency_code": "JPY",
    //       "amount": 10000
    //     },
    //     {
    //       "currency_code": "BTC",
    //       "amount": 1.23
    //     }
    //  ]
    var res = await request(options, function (err, response, payload) {
        console.log(payload);
        return payload
    });
    return res
}

