const key = '4z1Hg1tWmRna6CHVk8ZSm6';
const secret = 'IroSHCJ9V6G23wIgVpBeKtBGRMtPj1EIUTGJM6iFwHw=';
const request = require('request');
const crypto = require('crypto');
exports.getPosition = function () {
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
    request(options, function (err, response, payload) {
        if(err)
            console.log(err)
        console.log(payload);
    });
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