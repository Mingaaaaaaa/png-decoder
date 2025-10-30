class PNGParser {
    constructor() {
        this.chunks = [];
        this.header = null;
        this.fileBuffer = null;
    }

    parse(buffer) {
        this.fileBuffer = new Uint8Array(buffer);
        this.chunks = [];

        // 验证PNG文件签名
        if (!this.validatePNGSignature()) {
            throw new Error('不是有效的PNG文件');
        }

        // 解析所有数据块
        let offset = 8; // 跳过PNG签名
        while (offset < this.fileBuffer.length) {
            const chunk = this.parseChunk(offset);
            if (!chunk) break;

            this.chunks.push(chunk);
            offset += chunk.totalSize;

            if (chunk.type === 'IEND') break;
        }

        return {
            chunks: this.chunks,
            header: this.header,
            fileSize: this.fileBuffer.length
        };
    }

    validatePNGSignature() {
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) {
            if (this.fileBuffer[i] !== signature[i]) {
                return false;
            }
        }
        return true;
    }

    // 4(length) + 4(type) + data + 4(crc)
    parseChunk(offset) {
        if (offset + 8 > this.fileBuffer.length) return null;

        // 读取类型（4字节ASCII）
        const type = String.fromCharCode(...this.fileBuffer.slice(offset + 4, offset + 8));
        // 读取长度（4字节，大端序）
        const length = this.readUint32BE(offset);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const data = this.fileBuffer.slice(dataStart, dataEnd);
        const crc = this.readUint32BE(dataEnd);

        const chunk = {
            offset,
            length,
            type,
            data,
            crc,
            totalSize: length + 12, // 4(length) + 4(type) + 4(crc)
            description: this.getChunkDescription(type),
            isCritical: this.isCriticalChunk(type)
        };

        // 根据chunk类型解析具体数据
        switch (type) {
            case 'IHDR':
                this.header = this.parseIHDR(data);
                chunk.parsed = this.header;
                break;
            case 'tEXt':
                chunk.parsed = this.parseTextChunk(data);
                break;
            case 'zTXt':
                chunk.parsed = this.parseZTextChunk(data);
                break;
            case 'iTXt':
                chunk.parsed = this.parseITextChunk(data);
                break;
            case 'tIME':
                chunk.parsed = this.parseTimeChunk(data);
                break;
            case 'pHYs':
                chunk.parsed = this.parsePhysChunk(data);
                break;
            case 'gAMA':
                chunk.parsed = this.parseGammaChunk(data);
                break;
            case 'cHRM':
                chunk.parsed = this.parseChrmChunk(data);
                break;
            case 'sRGB':
                chunk.parsed = this.parseSRGBChunk(data);
                break;
            case 'sBIT':
                chunk.parsed = this.parseSBitChunk(data);
                break;
            case 'bKGD':
                chunk.parsed = this.parseBkgdChunk(data);
                break;
            case 'tRNS':
                chunk.parsed = this.parseTransChunk(data);
                break;
            case 'PLTE':
                chunk.parsed = this.parsePaletteChunk(data);
                break;
            case 'cICP':
                chunk.parsed = this.parseCicpChunk(data);
                break;
        }

        return chunk;
    }

    parseIHDR(data) {
        return {
            width: this.readUint32BE_fromArray(data, 0),
            height: this.readUint32BE_fromArray(data, 4),
            bitDepth: data[8],
            colorType: data[9],
            compressionMethod: data[10],
            filterMethod: data[11],
            interlaceMethod: data[12]
        };
    }

    parseTextChunk(data) {
        const text = new TextDecoder('latin1').decode(data);
        const nullIndex = text.indexOf('\0');
        if (nullIndex === -1) return { text };

        return {
            keyword: text.substring(0, nullIndex),
            text: text.substring(nullIndex + 1)
        };
    }

    parseTimeChunk(data) {
        if (data.length < 7) return null;
        return {
            year: this.readUint16BE_fromArray(data, 0),
            month: data[2],
            day: data[3],
            hour: data[4],
            minute: data[5],
            second: data[6]
        };
    }

    parsePhysChunk(data) {
        if (data.length < 9) return null;
        return {
            pixelsPerUnitX: this.readUint32BE_fromArray(data, 0),
            pixelsPerUnitY: this.readUint32BE_fromArray(data, 4),
            unitSpecifier: data[8] // 0=unknown, 1=meter
        };
    }

    parseZTextChunk(data) {
        const text = new TextDecoder('latin1').decode(data);
        const nullIndex = text.indexOf('\0');
        if (nullIndex === -1) return { text };

        const keyword = text.substring(0, nullIndex);
        const compressionMethod = data[nullIndex + 1];
        // 注意：这里简化处理，实际需要解压缩
        return {
            keyword,
            compressionMethod,
            compressedText: '压缩数据 (需要DEFLATE解压)'
        };
    }

    parseITextChunk(data) {
        try {
            let offset = 0;
            // 找到关键字结束位置
            let nullIndex = data.indexOf(0, offset);
            if (nullIndex === -1) return null;

            const keyword = new TextDecoder('utf-8').decode(data.slice(offset, nullIndex));
            offset = nullIndex + 1;

            // 压缩标志和压缩方法
            const compressionFlag = data[offset++];
            const compressionMethod = data[offset++];

            // 语言标签
            nullIndex = data.indexOf(0, offset);
            if (nullIndex === -1) return null;
            const languageTag = new TextDecoder('ascii').decode(data.slice(offset, nullIndex));
            offset = nullIndex + 1;

            // 翻译关键字
            nullIndex = data.indexOf(0, offset);
            if (nullIndex === -1) return null;
            const translatedKeyword = new TextDecoder('utf-8').decode(data.slice(offset, nullIndex));
            offset = nullIndex + 1;

            // 文本内容
            const text = new TextDecoder('utf-8').decode(data.slice(offset));

            return {
                keyword,
                compressionFlag,
                compressionMethod,
                languageTag,
                translatedKeyword,
                text
            };
        } catch (e) {
            return { error: '解析失败' };
        }
    }

    parseGammaChunk(data) {
        if (data.length < 4) return null;
        const gamma = this.readUint32BE_fromArray(data, 0);
        return {
            gamma: gamma / 100000, // PNG伽马值需要除以100000
            rawValue: gamma
        };
    }

    parseChrmChunk(data) {
        if (data.length < 32) return null;
        return {
            whitePointX: this.readUint32BE_fromArray(data, 0) / 100000,
            whitePointY: this.readUint32BE_fromArray(data, 4) / 100000,
            redX: this.readUint32BE_fromArray(data, 8) / 100000,
            redY: this.readUint32BE_fromArray(data, 12) / 100000,
            greenX: this.readUint32BE_fromArray(data, 16) / 100000,
            greenY: this.readUint32BE_fromArray(data, 20) / 100000,
            blueX: this.readUint32BE_fromArray(data, 24) / 100000,
            blueY: this.readUint32BE_fromArray(data, 28) / 100000
        };
    }

    parseSRGBChunk(data) {
        if (data.length < 1) return null;
        const renderingIntent = data[0];
        const intents = ['Perceptual', 'Relative colorimetric', 'Saturation', 'Absolute colorimetric'];
        return {
            renderingIntent,
            renderingIntentName: intents[renderingIntent] || 'Unknown'
        };
    }

    parseSBitChunk(data) {
        if (!this.header) return null;
        const result = {};

        if (this.header.colorType === 0) { // 灰度
            result.grayscale = data[0];
        } else if (this.header.colorType === 2) { // RGB
            result.red = data[0];
            result.green = data[1];
            result.blue = data[2];
        } else if (this.header.colorType === 3) { // 索引色
            result.red = data[0];
            result.green = data[1];
            result.blue = data[2];
        } else if (this.header.colorType === 4) { // 灰度+alpha
            result.grayscale = data[0];
            result.alpha = data[1];
        } else if (this.header.colorType === 6) { // RGB+alpha
            result.red = data[0];
            result.green = data[1];
            result.blue = data[2];
            result.alpha = data[3];
        }

        return result;
    }

    parseBkgdChunk(data) {
        if (!this.header) return null;
        const result = {};

        if (this.header.colorType === 0 || this.header.colorType === 4) { // 灰度
            result.gray = this.readUint16BE_fromArray(data, 0);
        } else if (this.header.colorType === 2 || this.header.colorType === 6) { // RGB
            result.red = this.readUint16BE_fromArray(data, 0);
            result.green = this.readUint16BE_fromArray(data, 2);
            result.blue = this.readUint16BE_fromArray(data, 4);
        } else if (this.header.colorType === 3) { // 索引色
            result.paletteIndex = data[0];
        }

        return result;
    }

    parseTransChunk(data) {
        if (!this.header) return null;
        const result = {};

        if (this.header.colorType === 0) { // 灰度
            result.gray = this.readUint16BE_fromArray(data, 0);
        } else if (this.header.colorType === 2) { // RGB
            result.red = this.readUint16BE_fromArray(data, 0);
            result.green = this.readUint16BE_fromArray(data, 2);
            result.blue = this.readUint16BE_fromArray(data, 4);
        } else if (this.header.colorType === 3) { // 索引色
            result.alphaValues = Array.from(data);
        }

        return result;
    }

    parsePaletteChunk(data) {
        const colors = [];
        for (let i = 0; i < data.length; i += 3) {
            if (i + 2 < data.length) {
                colors.push({
                    red: data[i],
                    green: data[i + 1],
                    blue: data[i + 2],
                    hex: `#${data[i].toString(16).padStart(2, '0')}${data[i + 1].toString(16).padStart(2, '0')}${data[i + 2].toString(16).padStart(2, '0')}`
                });
            }
        }
        return {
            colorCount: colors.length,
            colors: colors.slice(0, 16) // 只显示前16个颜色，避免过长
        };
    }

    parseCicpChunk(data) {
        if (data.length < 4) return null;
        return {
            colorPrimaries: data[0],
            transferFunction: data[1],
            matrixCoefficients: data[2],
            videoFullRangeFlag: data[3]
        };
    }

    readUint32BE(offset) {
        return (this.fileBuffer[offset] << 24) |
            (this.fileBuffer[offset + 1] << 16) |
            (this.fileBuffer[offset + 2] << 8) |
            this.fileBuffer[offset + 3];
    }

    readUint32BE_fromArray(array, offset) {
        return (array[offset] << 24) |
            (array[offset + 1] << 16) |
            (array[offset + 2] << 8) |
            array[offset + 3];
    }

    readUint16BE_fromArray(array, offset) {
        return (array[offset] << 8) | array[offset + 1];
    }

    isCriticalChunk(type) {
        return ['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type);
    }

    getChunkDescription(type) {
        const descriptions = {
            'IHDR': '图像头：包含图片基本信息（尺寸、位深度、颜色类型等）',
            'PLTE': '调色板：索引色图像的颜色表',
            'IDAT': '图像数据：压缩的像素数据',
            'IEND': '图像结束：PNG文件结束标记',
            'tRNS': '透明度：定义透明颜色',
            'cHRM': '色度：原色和白点坐标',
            'gAMA': '伽马：图像伽马值',
            'iCCP': 'ICC配置：嵌入的ICC颜色配置文件',
            'sBIT': '有效位：每通道的有效位数',
            'sRGB': 'sRGB：标准RGB色彩空间',
            'cICP': '编码无关代码点：视频信号类型标识（色彩空间、传递函数等）',
            'tEXt': '文本：未压缩的文本数据',
            'zTXt': '压缩文本：压缩的文本数据',
            'iTXt': '国际化文本：支持UTF-8的文本数据',
            'bKGD': '背景色：建议的背景颜色',
            'pHYs': '物理尺寸：像素的物理尺寸',
            'tIME': '时间戳：图像最后修改时间',
            'eXIf': 'EXIF：EXIF元数据',
            'acTL': 'APNG控制：动画控制信息',
            'fcTL': 'APNG帧控制：帧控制信息',
            'fdAT': 'APNG帧数据：动画帧数据'
        };
        return descriptions[type] || `未知数据块类型: ${type}`;
    }

    getColorTypeDescription(colorType) {
        const types = {
            0: '灰度',
            2: 'RGB',
            3: '索引色',
            4: '灰度 + Alpha',
            6: 'RGB + Alpha'
        };
        return types[colorType] || '未知';
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }
}

class App {
    constructor() {
        this.parser = new PNGParser();
        this.currentFile = null;
        this.initEventListeners();
    }

    initEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');

        // 点击上传区域
        uploadArea.addEventListener('click', () => fileInput.click());

        // 文件选择
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFile(e.target.files[0]);
            }
        });

        // 拖拽上传
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFile(files[0]);
            }
        });

        // URL输入功能
        document.getElementById('loadUrlButton').addEventListener('click', () => {
            this.loadImageFromUrl();
        });

        // 回车键加载URL
        document.getElementById('urlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.loadImageFromUrl();
            }
        });

        // 页面加载时自动加载示例图片
        this.loadDemoImage();
    }

    async loadImageFromUrl() {
        const urlInput = document.getElementById('urlInput');
        const loadButton = document.getElementById('loadUrlButton');
        const url = urlInput.value.trim();

        if (!url) {
            alert('请输入图片URL');
            return;
        }

        // 简单的URL格式验证
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            alert('请输入有效的URL（需要以http://或https://开头）');
            return;
        }

        // 检查是否是PNG文件
        if (!url.toLowerCase().includes('.png')) {
            const confirm = window.confirm('URL似乎不是PNG文件，是否继续尝试加载？');
            if (!confirm) return;
        }

        loadButton.disabled = true;
        loadButton.textContent = '加载中...';

        try {
            await this.loadImageFromUrlDirect(url);
        } catch (error) {
            this.showError('加载图片失败: ' + error.message);
        } finally {
            loadButton.disabled = false;
            loadButton.textContent = '加载';
        }
    }

    async loadImageFromUrlDirect(url) {
        this.showLoading();

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 无法访问图片`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && !contentType.includes('image')) {
                throw new Error('URL返回的不是图片文件');
            }

            const buffer = await response.arrayBuffer();
            const blob = new Blob([buffer], { type: 'image/png' });

            // 从URL提取文件名
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const filename = pathname.split('/').pop() || 'image.png';

            const file = new File([blob], filename, { type: 'image/png' });

            const result = this.parser.parse(buffer);
            this.displayResults(result, file);

            // 清空输入框
            document.getElementById('urlInput').value = '';

        } catch (error) {
            throw error;
        }
    }

    async loadDemoImage() {
        const demoUrl = 'https://cdn.jsdmirror.com/gh/Mingaaaaaaa/PictureBed@master/common-pic/b_2cae10cdf14221994d7f9bb18c341c5f.1jjq0pjm9s1s.png';

        this.showLoading();

        try {
            const response = await fetch(demoUrl);
            if (!response.ok) {
                throw new Error('无法加载示例图片');
            }

            const buffer = await response.arrayBuffer();
            const blob = new Blob([buffer], { type: 'image/png' });

            // 创建一个虚拟的File对象
            const file = new File([blob], 'demo-image.png', { type: 'image/png' });

            const result = this.parser.parse(buffer);
            this.displayResults(result, file);
        } catch (error) {
            this.showError('加载示例图片失败: ' + error.message);
        }
    }

    async handleFile(file) {
        if (!file.type.includes('png')) {
            this.showError('请选择PNG格式的图片文件');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            this.showError('文件大小不能超过10MB');
            return;
        }

        this.currentFile = file;
        this.showLoading();

        try {
            const buffer = await file.arrayBuffer();
            const result = this.parser.parse(buffer);
            this.displayResults(result, file);
        } catch (error) {
            this.showError('解析文件时出错: ' + error.message);
        }
    }

    showLoading() {
        const resultSection = document.getElementById('resultSection');
        resultSection.style.display = 'block';
        resultSection.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <div>正在解析PNG文件...</div>
            </div>
        `;
    }

    showError(message) {
        const resultSection = document.getElementById('resultSection');
        resultSection.style.display = 'block';
        resultSection.innerHTML = `
            <div class="error">${message}</div>
        `;
    }

    displayResults(result, file) {
        document.getElementById('resultSection').style.display = 'block';
        document.getElementById('resultSection').innerHTML = `
            <div class="section">
                <h2 class="section-title">📊 图片概览</h2>
                <div class="summary-grid" id="summaryGrid"></div>
            </div>

            <div class="section">
                <h2 class="section-title">🧩 数据块信息 & 🔍 十六进制查看器</h2>
                <div class="chunk-hex-container">
                    <div class="chunk-section">
                        <div class="chunk-list" id="chunkList"></div>
                    </div>
                    <div class="hex-section">
                        <div class="hex-viewer" id="hexViewer"></div>
                    </div>
                </div>
            </div>
        `;

        this.displayImagePreview(file);
        this.displaySummary(result, file);
        this.displayChunks(result.chunks);
        this.displayHexView(this.parser.fileBuffer);

        // 检查是否有cICP块，如果没有则显示添加按钮
        this.checkAndShowCicpAddButton(result.chunks);
    }

    displayImagePreview(file) {
        const preview = document.getElementById('imagePreview');
        const url = URL.createObjectURL(file);

        preview.innerHTML = `
            <img src="${url}" alt="PNG预览" class="preview-image">
            <div class="image-info">
                <strong>${file.name}</strong><br>
                ${this.parser.formatFileSize(file.size)}
            </div>
            <button id="cicpActionButton" class="cicp-action-button" style="display: none;">
                编辑色彩空间
            </button>
        `;

        // 显示预览区域
        preview.classList.add('show');
    }

    checkAndShowCicpAddButton(chunks) {
        // 检查是否已经有cICP块
        const hasCicp = chunks.some(chunk => chunk.type === 'cICP');
        const actionButton = document.getElementById('cicpActionButton');

        if (actionButton) {
            // 显示按钮
            actionButton.style.display = 'block';
            actionButton.style.width = '50%';
            actionButton.style.margin = '10px auto 0 auto';
            if (hasCicp) {
                // 如果有cICP块，显示编辑按钮
                actionButton.textContent = '编辑色彩空间';
                actionButton.onclick = () => this.openCicpEditor();
            } else {
                // 如果没有cICP块，显示添加按钮
                actionButton.textContent = '+ 添加HDR支持';
                actionButton.onclick = () => this.openCicpEditorForAdd();
            }
        }
    }

    displaySummary(result, file) {
        const grid = document.getElementById('summaryGrid');
        const header = result.header;

        const criticalChunks = result.chunks.filter(c => c.isCritical).length;
        const ancillaryChunks = result.chunks.filter(c => !c.isCritical).length;

        grid.innerHTML = `
            <div class="summary-card">
                <div class="summary-title">文件信息</div>
                <div class="summary-value">${file.name}</div>
                <div class="summary-value">${this.parser.formatFileSize(result.fileSize)}</div>
            </div>
            <div class="summary-card">
                <div class="summary-title">图像尺寸</div>
                <div class="summary-value">${header.width} × ${header.height}</div>
                <div style="font-size: 0.9rem; margin-top: 4px;">总像素: ${(header.width * header.height).toLocaleString()}</div>
            </div>
            <div class="summary-card">
                <div class="summary-title">颜色信息</div>
                <div class="summary-value">${this.parser.getColorTypeDescription(header.colorType)}</div>
                <div style="font-size: 0.9rem; margin-top: 4px;">位深度: ${header.bitDepth} bit</div>
            </div>
            <div class="summary-card">
                <div class="summary-title">数据块</div>
                <div class="summary-value">${result.chunks.length} 个</div>
                <div style="font-size: 0.9rem; margin-top: 4px;">关键: ${criticalChunks}，辅助: ${ancillaryChunks}</div>
            </div>
            <div class="summary-card">
                <div class="summary-title">压缩方式</div>
                <div class="summary-value">DEFLATE</div>
                <div style="font-size: 0.9rem; margin-top: 4px;">滤波: ${header.filterMethod}</div>
            </div>
            <div class="summary-card">
                <div class="summary-title">隔行扫描</div>
                <div class="summary-value">${header.interlaceMethod === 0 ? '无' : 'Adam7'}</div>
            </div>
        `;
    }

    displayChunks(chunks) {
        const list = document.getElementById('chunkList');

        list.innerHTML = chunks.map((chunk, index) => `
            <div class="chunk-item">
                <div class="chunk-header">
                    <div class="chunk-name">${chunk.type}(${chunk.isCritical ? '关键块' : '辅助块'})</div>
                    <div class="chunk-size">${this.parser.formatFileSize(chunk.length)}</div>
                </div>
                <div class="chunk-description">${chunk.description}</div>
                <div class="chunk-details">
                    <strong>详细信息:</strong><br>
                    偏移量: 0x${chunk.offset.toString(16).toUpperCase()}<br>
                    数据长度: ${chunk.length} 字节<br>
                    CRC: 0x${chunk.crc.toString(16).toUpperCase()}<br>
                    ${this.formatParsedData(chunk)}
                </div>
            </div>
        `).join('');
    }

    formatParsedData(chunk) {
        if (!chunk.parsed) return '';

        const p = chunk.parsed;

        switch (chunk.type) {
            case 'IHDR':
                return `<br><strong>IHDR 解析:</strong><br>
                        宽度: ${p.width}px<br>
                        高度: ${p.height}px<br>
                        位深度: ${p.bitDepth}<br>
                        颜色类型: ${p.colorType} (${this.parser.getColorTypeDescription(p.colorType)})<br>
                        压缩方法: ${p.compressionMethod}<br>
                        滤波方法: ${p.filterMethod}<br>
                        隔行方法: ${p.interlaceMethod}`;

            case 'tEXt':
                return `<br><strong>文本内容:</strong><br>
                        关键字: ${p.keyword || 'N/A'}<br>
                        内容: ${p.text || 'N/A'}`;

            case 'zTXt':
                return `<br><strong>压缩文本:</strong><br>
                        关键字: ${p.keyword || 'N/A'}<br>
                        压缩方法: ${p.compressionMethod}<br>
                        内容: ${p.compressedText}`;

            case 'iTXt':
                if (p.error) return `<br><strong>国际化文本:</strong><br>错误: ${p.error}`;
                return `<br><strong>国际化文本:</strong><br>
                        关键字: ${p.keyword}<br>
                        语言标签: ${p.languageTag || 'N/A'}<br>
                        翻译关键字: ${p.translatedKeyword || 'N/A'}<br>
                        压缩标志: ${p.compressionFlag ? '是' : '否'}<br>
                        内容: ${p.text || 'N/A'}`;

            case 'tIME':
                return `<br><strong>时间信息:</strong><br>
                        日期: ${p.year}-${p.month.toString().padStart(2, '0')}-${p.day.toString().padStart(2, '0')}<br>
                        时间: ${p.hour.toString().padStart(2, '0')}:${p.minute.toString().padStart(2, '0')}:${p.second.toString().padStart(2, '0')}`;

            case 'pHYs':
                const unit = p.unitSpecifier === 1 ? '米' : '未知单位';
                return `<br><strong>物理尺寸:</strong><br>
                        X轴: ${p.pixelsPerUnitX} 像素/${unit}<br>
                        Y轴: ${p.pixelsPerUnitY} 像素/${unit}<br>
                        单位类型: ${p.unitSpecifier}`;

            case 'gAMA':
                return `<br><strong>伽马值:</strong><br>
                        伽马: ${p.gamma.toFixed(5)}<br>
                        原始值: ${p.rawValue}`;

            case 'cHRM':
                return `<br><strong>色度坐标:</strong><br>
                        白点: (${p.whitePointX.toFixed(4)}, ${p.whitePointY.toFixed(4)})<br>
                        红色: (${p.redX.toFixed(4)}, ${p.redY.toFixed(4)})<br>
                        绿色: (${p.greenX.toFixed(4)}, ${p.greenY.toFixed(4)})<br>
                        蓝色: (${p.blueX.toFixed(4)}, ${p.blueY.toFixed(4)})`;

            case 'sRGB':
                return `<br><strong>sRGB 信息:</strong><br>
                        渲染意图: ${p.renderingIntent} (${p.renderingIntentName})`;

            case 'sBIT':
                let sbitInfo = '<br><strong>有效位数:</strong><br>';
                Object.entries(p).forEach(([key, value]) => {
                    sbitInfo += `${key}: ${value} 位<br>`;
                });
                return sbitInfo.slice(0, -4); // 移除最后的<br>

            case 'bKGD':
                let bkgdInfo = '<br><strong>背景颜色:</strong><br>';
                if (p.gray !== undefined) {
                    bkgdInfo += `灰度值: ${p.gray}`;
                } else if (p.red !== undefined) {
                    bkgdInfo += `RGB: (${p.red}, ${p.green}, ${p.blue})`;
                } else if (p.paletteIndex !== undefined) {
                    bkgdInfo += `调色板索引: ${p.paletteIndex}`;
                }
                return bkgdInfo;

            case 'tRNS':
                let transInfo = '<br><strong>透明度:</strong><br>';
                if (p.gray !== undefined) {
                    transInfo += `透明灰度值: ${p.gray}`;
                } else if (p.red !== undefined) {
                    transInfo += `透明RGB: (${p.red}, ${p.green}, ${p.blue})`;
                } else if (p.alphaValues) {
                    transInfo += `Alpha值数组: [${p.alphaValues.slice(0, 10).join(', ')}${p.alphaValues.length > 10 ? '...' : ''}]`;
                }
                return transInfo;

            case 'PLTE':
                let paletteInfo = `<br><strong>调色板:</strong><br>颜色数量: ${p.colorCount}<br>`;
                if (p.colors.length > 0) {
                    paletteInfo += '颜色预览:<br>';
                    p.colors.forEach((color, i) => {
                        paletteInfo += `<span style="display:inline-block;width:20px;height:20px;background:${color.hex};border:1px solid #ccc;margin:2px;vertical-align:middle;" title="${color.hex}"></span>`;
                        if ((i + 1) % 8 === 0) paletteInfo += '<br>';
                    });
                }
                return paletteInfo;

            case 'cICP':
                return `<br><strong>cICP 编码无关代码点:</strong><br>
                        色彩基准: ${p.colorPrimaries} (${this.getCicpPrimariesName(p.colorPrimaries)})<br>
                        传递函数: ${p.transferFunction} (${this.getCicpTransferName(p.transferFunction)})<br>
                        矩阵系数: ${p.matrixCoefficients} (${this.getCicpMatrixName(p.matrixCoefficients)})<br>
                        全范围标志: ${p.videoFullRangeFlag} (${p.videoFullRangeFlag ? '全范围' : '窄范围'}`;

            default:
                return '';
        }
    }

    getCicpPrimariesName(value) {
        const names = {
            0: 'Reserved',
            1: 'BT.709 / sRGB',
            2: 'Unspecified',
            4: 'BT.470 System M',
            5: 'BT.470 System B,G / BT.601 625',
            6: 'BT.601 525 / SMPTE 170',
            7: 'SMPTE 240',
            8: 'Generic film',
            9: 'BT.2020 / BT.2100',
            10: 'SMPTE ST 428-1 (XYZ)',
            11: 'SMPTE RP 431-2',
            12: 'SMPTE EG 432-1 / Display P3',
            22: 'Unspecified'
        };
        return names[value] || 'Unknown';
    }

    getCicpTransferName(value) {
        const names = {
            0: 'Reserved',
            1: 'BT.709',
            2: 'Unspecified',
            4: 'Gamma 2.2',
            5: 'Gamma 2.8',
            6: 'BT.601',
            7: 'SMPTE 240',
            8: 'Linear',
            9: 'Log (100:1)',
            10: 'Log (100*√10:1)',
            11: 'IEC 61966-2-4',
            12: 'BT.1361',
            13: 'sRGB',
            14: 'BT.2020 (10-bit)',
            15: 'BT.2020 (12-bit)',
            16: 'SMPTE ST 2084 (PQ)',
            17: 'SMPTE ST 428-1',
            18: 'ARIB STD-B67 (HLG)'
        };
        return names[value] || 'Unknown';
    }

    getCicpMatrixName(value) {
        const names = {
            0: 'Identity (RGB/GBR)',
            1: 'BT.709',
            2: 'Unspecified',
            4: 'FCC',
            5: 'BT.470 System B,G / BT.601',
            6: 'BT.601',
            7: 'SMPTE 240',
            8: 'YCgCo',
            9: 'BT.2020 NCL',
            10: 'BT.2020 CL',
            11: 'SMPTE ST 2085',
            12: 'Chromaticity-derived NCL',
            13: 'Chromaticity-derived CL',
            14: 'ICtCp'
        };
        return names[value] || 'Unknown';
    }

    displayHexView(buffer) {
        const viewer = document.getElementById('hexViewer');
        const totalBytes = buffer.length;
        let html = '';

        // 显示前1000字节
        const firstChunkEnd = Math.min(1000, totalBytes);
        html += '<div style="color: #569cd6; margin-bottom: 10px; font-weight: bold;">📁 文件开头 (前1000字节)</div>';

        for (let i = 0; i < firstChunkEnd; i += 16) {
            const offset = i.toString(16).padStart(8, '0').toUpperCase();
            let hexBytes = '';
            let ascii = '';

            for (let j = 0; j < 16 && i + j < firstChunkEnd; j++) {
                const byte = buffer[i + j];
                hexBytes += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
                ascii += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
            }

            html += `<div class="hex-row">
                <span class="offset">${offset}</span>
                <span class="hex-bytes">${hexBytes.padEnd(48, ' ')}</span>
                <span class="ascii">${ascii}</span>
            </div>`;
        }

        // 如果文件大于2000字节，显示中间省略信息和后1000字节
        if (totalBytes > 2000) {
            const lastChunkStart = totalBytes - 1000;
            const skippedBytes = lastChunkStart - firstChunkEnd;

            html += `<div style="color: #ce9178; margin: 15px 0; text-align: center; font-style: italic;">
                ... 省略 ${skippedBytes} 字节 (偏移 0x${firstChunkEnd.toString(16).toUpperCase()} - 0x${(lastChunkStart - 1).toString(16).toUpperCase()}) ...
            </div>`;

            html += '<div style="color: #569cd6; margin-bottom: 10px; font-weight: bold;">📄 文件结尾 (后1000字节)</div>';

            for (let i = lastChunkStart; i < totalBytes; i += 16) {
                const offset = i.toString(16).padStart(8, '0').toUpperCase();
                let hexBytes = '';
                let ascii = '';

                for (let j = 0; j < 16 && i + j < totalBytes; j++) {
                    const byte = buffer[i + j];
                    hexBytes += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
                    ascii += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                }

                html += `<div class="hex-row">
                    <span class="offset">${offset}</span>
                    <span class="hex-bytes">${hexBytes.padEnd(48, ' ')}</span>
                    <span class="ascii">${ascii}</span>
                </div>`;
            }
        } else if (totalBytes > 1000) {
            // 文件在1000-2000字节之间，显示剩余部分
            html += '<div style="color: #569cd6; margin: 15px 0 10px 0; font-weight: bold;">📄 文件剩余部分</div>';

            for (let i = firstChunkEnd; i < totalBytes; i += 16) {
                const offset = i.toString(16).padStart(8, '0').toUpperCase();
                let hexBytes = '';
                let ascii = '';

                for (let j = 0; j < 16 && i + j < totalBytes; j++) {
                    const byte = buffer[i + j];
                    hexBytes += byte.toString(16).padStart(2, '0').toUpperCase() + ' ';
                    ascii += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
                }

                html += `<div class="hex-row">
                    <span class="offset">${offset}</span>
                    <span class="hex-bytes">${hexBytes.padEnd(48, ' ')}</span>
                    <span class="ascii">${ascii}</span>
                </div>`;
            }
        }

        // 显示文件总大小信息
        html += `<div style="color: #569cd6; margin-top: 15px; text-align: center; border-top: 1px solid #333; padding-top: 10px;">
            📊 文件总大小: ${totalBytes} 字节 (0x${totalBytes.toString(16).toUpperCase()})
        </div>`;

        viewer.innerHTML = html;
    }

    openCicpEditor() {
        // 查找当前图片中的cICP块
        let currentCicp = null;
        const cicpChunk = this.parser.chunks.find(chunk => chunk.type === 'cICP');

        if (cicpChunk && cicpChunk.parsed) {
            currentCicp = cicpChunk.parsed;
        }

        this.showCicpEditor(currentCicp);
    }

    openCicpEditorForAdd() {
        // 为添加新cICP块打开编辑器，使用sRGB作为默认值
        const defaultCicp = {
            colorPrimaries: 1,    // BT.709 / sRGB
            transferFunction: 13, // sRGB
            matrixCoefficients: 0, // Identity (RGB)
            videoFullRangeFlag: 1  // Full range
        };

        this.showCicpEditor(defaultCicp, true); // true表示是添加模式
    }

    showCicpEditor(currentCicp, isAddMode = false) {
        const modal = document.createElement('div');
        modal.className = 'cicp-modal';
        modal.innerHTML = `
            <div class="cicp-modal-content">
                <div class="cicp-modal-header">
                    <h3>${isAddMode ? '添加 cICP 色彩空间支持' : '编辑 cICP (编码无关代码点)'}</h3>
                    <span class="cicp-modal-close">&times;</span>
                </div>
                <div class="cicp-modal-body">
                    ${isAddMode ? `
                        <div class="cicp-add-notice">
                            <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 20px; border-left: 3px solid #6c757d;">
                                <strong style="color: #495057;">添加 HDR 色彩支持</strong><br>
                                <span style="color: #6c757d; font-size: 0.9rem;">
                                    支持 HDR10、HLG 和 Display P3 显示
                                </span>
                            </div>
                        </div>
                    ` : ''}
                    <div class="cicp-field">
                        <label>色彩基准 (Color Primaries):</label>
                        <select id="cicpPrimaries">
                            <option value="1">1 - BT.709 / sRGB</option>
                            <option value="9">9 - BT.2020 / BT.2100</option>
                            <option value="12">12 - Display P3</option>
                            <option value="2">2 - Unspecified</option>
                            <option value="4">4 - BT.470 System M</option>
                            <option value="5">5 - BT.470 System B,G / BT.601 625</option>
                            <option value="6">6 - BT.601 525 / SMPTE 170</option>
                            <option value="7">7 - SMPTE 240</option>
                            <option value="8">8 - Generic film</option>
                            <option value="10">10 - SMPTE ST 428-1 (XYZ)</option>
                            <option value="11">11 - SMPTE RP 431-2</option>
                        </select>
                    </div>
                    <div class="cicp-field">
                        <label>传递函数 (Transfer Function):</label>
                        <select id="cicpTransfer">
                            <option value="1">1 - BT.709</option>
                            <option value="13">13 - sRGB</option>
                            <option value="16">16 - SMPTE ST 2084 (PQ)</option>
                            <option value="18">18 - ARIB STD-B67 (HLG)</option>
                            <option value="2">2 - Unspecified</option>
                            <option value="4">4 - Gamma 2.2</option>
                            <option value="5">5 - Gamma 2.8</option>
                            <option value="6">6 - BT.601</option>
                            <option value="7">7 - SMPTE 240</option>
                            <option value="8">8 - Linear</option>
                            <option value="14">14 - BT.2020 (10-bit)</option>
                            <option value="15">15 - BT.2020 (12-bit)</option>
                        </select>
                    </div>
                    <div class="cicp-field">
                        <label>矩阵系数 (Matrix Coefficients):</label>
                        <select id="cicpMatrix">
                            <option value="0">0 - Identity (RGB/GBR)</option>
                            <option value="1">1 - BT.709</option>
                            <option value="2">2 - Unspecified</option>
                            <option value="5">5 - BT.470 System B,G / BT.601</option>
                            <option value="6">6 - BT.601</option>
                            <option value="7">7 - SMPTE 240</option>
                            <option value="9">9 - BT.2020 NCL</option>
                            <option value="14">14 - ICtCp</option>
                        </select>
                    </div>
                    <div class="cicp-field">
                        <label>视频范围标志 (Video Full Range Flag):</label>
                        <select id="cicpRange">
                            <option value="1">1 - 全范围 (Full Range)</option>
                            <option value="0">0 - 窄范围 (Narrow Range)</option>
                        </select>
                    </div>
                    <div class="cicp-presets">
                        <label>常用预设:</label>
                        <div class="preset-categories">
                            <div class="preset-category">
                                <span class="preset-category-title">🖥️ 标准显示:</span>
                                <button type="button" onclick="app.applyCicpPreset('sRGB')">sRGB</button>
                                <button type="button" onclick="app.applyCicpPreset('bt709')">BT.709</button>
                            </div>
                            <div class="preset-category">
                                <span class="preset-category-title">🌈 广色域:</span>
                                <button type="button" onclick="app.applyCicpPreset('displayP3')">Display P3</button>
                            </div>
                            <div class="preset-category">
                                <span class="preset-category-title">✨ HDR:</span>
                                <button type="button" onclick="app.applyCicpPreset('bt2020PQ')">HDR10 (PQ)</button>
                                <button type="button" onclick="app.applyCicpPreset('bt2020HLG')">HLG</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="cicp-modal-footer">
                    <button id="cicpSave">${isAddMode ? '添加 cICP 块' : '应用设置'}</button>
                    <button id="cicpCancel">取消</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 设置当前值
        if (currentCicp) {
            document.getElementById('cicpPrimaries').value = currentCicp.colorPrimaries;
            document.getElementById('cicpTransfer').value = currentCicp.transferFunction;
            document.getElementById('cicpMatrix').value = currentCicp.matrixCoefficients;
            document.getElementById('cicpRange').value = currentCicp.videoFullRangeFlag;
        }

        // 绑定事件
        modal.querySelector('.cicp-modal-close').onclick = () => this.closeCicpEditor();
        document.getElementById('cicpCancel').onclick = () => this.closeCicpEditor();
        document.getElementById('cicpSave').onclick = () => this.saveCicpChanges();

        // 点击外部关闭
        modal.onclick = (e) => {
            if (e.target === modal) this.closeCicpEditor();
        };
    }

    applyCicpPreset(preset) {
        const presets = {
            'sRGB': { primaries: 1, transfer: 13, matrix: 0, range: 1 },
            'displayP3': { primaries: 12, transfer: 13, matrix: 0, range: 1 },
            'bt2020PQ': { primaries: 9, transfer: 16, matrix: 0, range: 1 },
            'bt2020HLG': { primaries: 9, transfer: 18, matrix: 0, range: 1 },
            'bt709': { primaries: 1, transfer: 1, matrix: 0, range: 1 }
        };

        const values = presets[preset];
        if (values) {
            document.getElementById('cicpPrimaries').value = values.primaries;
            document.getElementById('cicpTransfer').value = values.transfer;
            document.getElementById('cicpMatrix').value = values.matrix;
            document.getElementById('cicpRange').value = values.range;
        }
    }

    closeCicpEditor() {
        const modal = document.querySelector('.cicp-modal');
        if (modal) {
            modal.remove();
        }
    }

    async saveCicpChanges() {
        const newCicp = {
            colorPrimaries: parseInt(document.getElementById('cicpPrimaries').value),
            transferFunction: parseInt(document.getElementById('cicpTransfer').value),
            matrixCoefficients: parseInt(document.getElementById('cicpMatrix').value),
            videoFullRangeFlag: parseInt(document.getElementById('cicpRange').value)
        };

        try {
            const newPngBuffer = this.generatePngWithNewCicp(newCicp);

            // 验证生成的PNG
            const testResult = this.parser.parse(newPngBuffer);

            this.closeCicpEditor();

            // 更新页面显示数据和图片预览
            const file = new File([newPngBuffer], 'modified-cicp.png', { type: 'image/png' });
            this.displayResults(testResult, file);

            // 显示成功消息
            const hasOriginalCicp = this.parser.chunks.some(chunk => chunk.type === 'cICP');
            const message = hasOriginalCicp ? 'cICP设置已成功更新！' : 'cICP块已成功添加！现在支持高级色彩空间🎨';
            this.showSuccessMessage(message);

        } catch (error) {
            console.error('生成PNG错误:', error);
            alert('更新cICP设置时出错: ' + error.message);
        }
    }

    generatePngWithNewCicp(newCicp) {
        const originalBuffer = new Uint8Array(this.parser.fileBuffer);
        const chunks = [];

        let offset = 8; // 跳过PNG签名
        let cicpAdded = false;

        // 解析所有原始块
        while (offset < originalBuffer.length) {
            const length = this.readUint32BE(originalBuffer, offset);
            const typeBytes = originalBuffer.slice(offset + 4, offset + 8);
            const type = String.fromCharCode(...typeBytes);
            const chunkData = originalBuffer.slice(offset + 8, offset + 8 + length);
            const crc = this.readUint32BE(originalBuffer, offset + 8 + length);

            if (type === 'cICP') {
                // 替换现有的cICP块
                const newCicpData = new Uint8Array([
                    newCicp.colorPrimaries,
                    newCicp.transferFunction,
                    newCicp.matrixCoefficients,
                    newCicp.videoFullRangeFlag
                ]);
                chunks.push({
                    type: 'cICP',
                    data: newCicpData,
                    isNew: true
                });
                cicpAdded = true;
            } else if (type === 'IDAT' && !cicpAdded) {
                // 在第一个IDAT块前添加cICP块
                const newCicpData = new Uint8Array([
                    newCicp.colorPrimaries,
                    newCicp.transferFunction,
                    newCicp.matrixCoefficients,
                    newCicp.videoFullRangeFlag
                ]);
                chunks.push({
                    type: 'cICP',
                    data: newCicpData,
                    isNew: true
                });
                cicpAdded = true;

                // 然后添加IDAT块
                chunks.push({
                    type: type,
                    data: chunkData,
                    isNew: false
                });
            } else {
                // 保留原始块
                chunks.push({
                    type: type,
                    data: chunkData,
                    isNew: false
                });
            }

            offset += 12 + length;

            if (type === 'IEND') break;
        }

        // 计算新PNG的总大小
        let totalSize = 8; // PNG签名
        chunks.forEach(chunk => {
            totalSize += 12 + chunk.data.length; // length(4) + type(4) + data + crc(4)
        });

        // 创建新的PNG缓冲区
        const newBuffer = new ArrayBuffer(totalSize);
        const newView = new Uint8Array(newBuffer);
        let writeOffset = 0;

        // 写入PNG签名
        const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        newView.set(signature, writeOffset);
        writeOffset += 8;

        // 写入所有块
        chunks.forEach(chunk => {
            // 写入长度（大端序）
            const length = chunk.data.length;
            newView[writeOffset] = (length >>> 24) & 0xFF;
            newView[writeOffset + 1] = (length >>> 16) & 0xFF;
            newView[writeOffset + 2] = (length >>> 8) & 0xFF;
            newView[writeOffset + 3] = length & 0xFF;
            writeOffset += 4;

            // 写入类型
            for (let i = 0; i < 4; i++) {
                newView[writeOffset + i] = chunk.type.charCodeAt(i);
            }
            writeOffset += 4;

            // 写入数据
            newView.set(chunk.data, writeOffset);
            writeOffset += chunk.data.length;

            // 计算并写入CRC（类型 + 数据）
            const crcData = new Uint8Array(4 + chunk.data.length);
            for (let i = 0; i < 4; i++) {
                crcData[i] = chunk.type.charCodeAt(i);
            }
            crcData.set(chunk.data, 4);
            const crc = this.calculateCRC32(crcData);

            newView[writeOffset] = (crc >>> 24) & 0xFF;
            newView[writeOffset + 1] = (crc >>> 16) & 0xFF;
            newView[writeOffset + 2] = (crc >>> 8) & 0xFF;
            newView[writeOffset + 3] = crc & 0xFF;
            writeOffset += 4;
        });

        return newBuffer;
    }

    readUint32BE(buffer, offset) {
        return (buffer[offset] << 24) |
            (buffer[offset + 1] << 16) |
            (buffer[offset + 2] << 8) |
            buffer[offset + 3];
    }


    calculateCRC32(data) {
        // 标准PNG CRC32计算
        const crcTable = this.getCRC32Table();
        let crc = 0xFFFFFFFF;

        for (let i = 0; i < data.length; i++) {
            crc = crcTable[((crc ^ data[i]) & 0xFF)] ^ (crc >>> 8);
        }

        return (crc ^ 0xFFFFFFFF) >>> 0; // 确保是无符号32位整数
    }

    getCRC32Table() {
        if (!this.crcTable) {
            this.crcTable = new Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let j = 0; j < 8; j++) {
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                }
                this.crcTable[i] = c;
            }
        }
        return this.crcTable;
    }

    downloadPng(buffer, filename) {
        const blob = new Blob([buffer], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showSuccessMessage(message) {
        // 创建成功提示
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            font-size: 14px;
            z-index: 2000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transition: all 0.3s ease;
        `;
        toast.textContent = message;

        document.body.appendChild(toast);

        // 3秒后自动消失
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }
}

// 初始化应用
const app = new App();
