var CurrentAccount = new Vue({
	el: '#currentAccount',
	data: {
		address: ''
	}
});
var ProxyContractAddress = new Vue({ 
    el: '#proxyContractAddress',
    data: {
		address: '0xf174efd44c1dadccc91134f9aec6b2ff4f8f6aee'
    }
});
var MultisenderAddress = new Vue({
	el:'#multisenderAddress',
	data:{
		address: '0xf0a22d95c244b56f3ff7c5c9579ddc68c29b8a2f'
	}
});
var ErrorMessage = new Vue({
	el: '#errormessage',
	data: {
		message: ''
	}
});
var Submit = new Vue({
	el: '#btnRun',
	data: {
		name: 'run'
	},
	// 在 `methods` 对象中定义方法
	methods: {
		getTransferInfo: function (event) {
			var isError = false;
			var msg = new Array;

			if (ProxyContractAddress.address == '') {
				msg.push('ProxyContractAddress is necessary.');
				isError = true;
			}
			if (MultisenderAddress.address == '') {
				msg.push('MultisenderAddress is necessary.');
				isError = true;
			}			
			if (isError) {
				ErrorMessage.message = '';
				for (var i in msg) {
					ErrorMessage.message += msg[i] + '\n';
				}
				return;
			}
			startApp();
		}
	}
})
//const batchTransferContractAddress = '0x1745A2A561952B51c15C93847Cb746F47fb9Aa2e';
var myContract;

window.onload = function() {
	console.log(0);
	if (typeof web3 !== 'undefined') {
	    web3 = new Web3(web3.currentProvider);
	    console.log(1);
	} else {
		console.log(2);	
		ErrorMessage.message ='Your Browser Need Install web3.extend Tool.';
		return;
	}

	var v = web3.version;  //获取web3的版本
	console.log(v);	

	web3.eth.defaultAccount = web3.eth.accounts[0];
	CurrentAccount.address = web3.eth.accounts[0];
	if (web3.eth.accounts.length == 0)
		ErrorMessage.message = 'We can\'t read your ETH account address.';
};

function convertArray(values) {
	return values.replace(/\ +/g, "").replace(/[\r\n]/g, "").split(',')
}

function startApp(){
	var myProxyContractAddress = ProxyContractAddress.address;//'0xBD0dC36a80f01BF6b9786EbFCcd53BBE835BC493';
	myProxyContract = web3.eth.contract(myContractABI).at(myProxyContractAddress);
	//myProxyContract.currentFee(CurrentAccount.address,function(error,result){
	myProxyContract.initialize(CurrentAccount.address,function(error,result){
		if (!error)
		console.log(result);
		else
		console.log(error);
	});
	// myProxyContract.setDiscountStep("1",function(error,result){
	// 	if (!error)
	// 	console.log(result);
	// 	else
	// 	console.log(error);
	// });
}



