// 文件 WriteStream.js
let fs = require('fs');
let EventEmitter = require('events');
class WriteStream extends EventEmitter {
    constructor(path, options = {}) {
        super();
        this.path = path;
        this.flags = options.flags || 'w';
        this.encoding = options.encoding || 'utf8';
        this.start = options.start || 0;
        this.pos = this.start;
        this.mode = options.mode || 0o666;
        this.autoClose = options.autoClose || true;
        this.highWaterMark = options.highWaterMark || 16 * 1024;
        this.open(); // fd 异步的  //触发一个open事件,当触发open事件后fd肯定就存在了

        // 写文件的时候 需要的参数有哪些
        // 第一次写入是真的往文件里写
        this.writing = false; // 默认第一次就不是正在写入
        // 用简单的数组来模拟一下缓存
        this.cache = [];
        // 维护一个变量，表示缓存的长度
        this.len = 0;
        // 是否触发drain事件
        this.needDrain = false;
    }
    close() {

    }
    clearBuffer() {
        let buffer = this.cache.shift();
        if (buffer) { // 如果缓存里有
            this._write(buffer.chunk, buffer.encoding, () => this.clearBuffer());
        } else {// 如果缓存里没有了
            if (this.needDrain) { // 需要触发drain事件
                this.writing = false; // 告诉下次直接写就可以了 不需要写到内存中了
                this.needDrain = false;
                this.emit('drain');
            }
        }
    }
    _write(chunk, encoding, clearBuffer) { // 因为write方法是同步调用的此时fd还没有获取到，所以等待获取到再执行write操作
        if (typeof this.fd != 'number') {
            return this.once('open', () => this._write(chunk, encoding, clearBuffer));
        }
        fs.write(this.fd, chunk, 0, chunk.length, this.pos, (err, byteWritten) => {
            this.pos += byteWritten;
            this.len -= byteWritten; // 每次写入后就要在内存中减少一下
            clearBuffer(); // 第一次就写完了
        })
    }
    write(chunk, encoding = this.encoding) { // 客户调用的是write方法去写入内容
        // 要判断 chunk必须是buffer或者字符串 为了统一，如果传递的是字符串也要转成buffer
        chunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        this.len += chunk.length; // 维护缓存的长度 3
        let ret = this.len < this.highWaterMark;
        if (!ret) {
            this.needDrain = true; // 表示需要触发drain事件
        }
        if (this.writing) { // 表示正在写入，应该放到内存中
            this.cache.push({
                chunk,
                encoding,
            });
        } else { // 第一次
            this.writing = true;
            this._write(chunk, encoding, () => this.clearBuffer()); // 专门实现写的方法
        }
        return ret; // 能不能继续写了，false表示下次的写的时候就要占用更多内存了
    }
    destroy() {
        if (typeof this.fd != 'number') {
            console.log('73@ close')
            this.emit('close');
        } else {
            console.log('76@ close')
            fs.close(this.fd, () => {
                this.emit('close');
            });
        }
    }
    open() {
        fs.open(this.path, this.flags, this.mode, (err, fd) => {
            if (err) {
                this.emit('error', err);
                if (this.autoClose) {
                    this.destroy(); // 如果自动关闭就销毁文件描述符
                }
                return;
            }
            this.fd = fd;
            this.emit('open', this.fd);
        });
    }
}
module.exports = WriteStream;
