// 打点功能模块
class AnnotationManager {
    constructor() {
        this.annotations = [];
        this.currentVideoFile = null;
        this.player = null;
        this.isLoading = false;
        this.hidePopupTimer = null; // 用于延迟隐藏popup的定时器
        
        // 设置 Electron API
        if (typeof window !== 'undefined' && !window.electronAPI) {
            const { ipcRenderer } = require('electron');
            window.electronAPI = {
                readAnnotationFile: (filePath) => ipcRenderer.invoke('read-annotation-file', filePath),
                writeAnnotationFile: (filePath, data) => ipcRenderer.invoke('write-annotation-file', filePath, data)
            };
        }
    }

    // 规范化level值：确保默认level始终为null
    normalizeLevel(level) {
        if (level === null || level === undefined || level === '' || level === 'default') {
            return null;
        }
        return String(level);
    }

    // 初始化打点管理器
    init(player) {
        this.player = player;
        this.setupEventListeners();
    }

    // 设置事件监听器
    setupEventListeners() {
        // 监听视频加载事件，自动加载打点文件
        if (this.player) {
            this.player.on('loadedmetadata', () => {
                this.loadAnnotationsFromFile();
            });
        }
    }

    // 设置当前视频文件路径
    setCurrentVideoFile(filePath) {
        this.currentVideoFile = filePath;
        this.annotations = [];
        // 立即清理UI显示
        this.updateProgressBarAnnotations();
        this.updateOutlineView();
    }

    // 添加打点
    async addAnnotation(time, title = '', text = '', color = 'blue', level = null, duration = null) {
        if (!this.currentVideoFile) {
            return false;
        }

        const annotation = {
            id: Date.now().toString(),
            time: Math.round(time * 100) / 100, // 保留2位小数
            title: title.trim(),
            text: text.trim(),
            color: color,
            level: level,
            duration: duration ? Math.round(duration * 100) / 100 : null, // 时长，保留2位小数
            createdAt: new Date().toISOString()
        };

        this.annotations.push(annotation);
        this.annotations.sort((a, b) => a.time - b.time); // 按时间排序

        // 保存到文件
        await this.saveAnnotationsToFile();
        
        // 更新UI显示
        this.updateProgressBarAnnotations();
        
        // 更新大纲视图
        this.updateOutlineView();
        
        return annotation;
    }

    // 删除打点
    async deleteAnnotation(annotationId) {
        const index = this.annotations.findIndex(ann => ann.id === annotationId);
        if (index !== -1) {
            this.annotations.splice(index, 1);
            await this.saveAnnotationsToFile();
            this.updateProgressBarAnnotations();
            this.updateOutlineView();
            return true;
        }
        return false;
    }

    // 编辑打点
    async editAnnotation(annotationId, newTitle = '', newText = '', newColor = null, newLevel = 'UNCHANGED', newDuration = 'UNCHANGED') {
        const annotation = this.annotations.find(ann => ann.id === annotationId);
        if (annotation) {
            annotation.title = newTitle.trim();
            annotation.text = newText.trim();
            if (newColor !== null) annotation.color = newColor;
            if (newLevel !== 'UNCHANGED') annotation.level = newLevel; // 允许设置为null
            if (newDuration !== 'UNCHANGED') annotation.duration = newDuration ? Math.round(newDuration * 100) / 100 : null;
            annotation.updatedAt = new Date().toISOString();
            await this.saveAnnotationsToFile();
            this.updateProgressBarAnnotations();
            this.updateOutlineView();
            return true;
        }
        return false;
    }

    // 获取指定时间的打点
    getAnnotationAtTime(time, tolerance = 0.5) {
        return this.annotations.find(ann => 
            Math.abs(ann.time - time) <= tolerance
        );
    }

    // 获取所有打点
    getAllAnnotations() {
        return [...this.annotations];
    }

    // 跳转到指定打点
    jumpToAnnotation(annotationId) {
        const annotation = this.annotations.find(ann => ann.id === annotationId);
        if (annotation && this.player) {
            this.player.currentTime(annotation.time);
            return true;
        }
        return false;
    }

    // 生成打点文件路径
    getAnnotationFilePath() {
        if (!this.currentVideoFile) return null;
        
        const pathParts = this.currentVideoFile.split('.');
        pathParts.pop(); // 移除扩展名
        return pathParts.join('.') + '.videotalker.json';
    }

    // 从文件加载打点数据
    async loadAnnotationsFromFile() {
        if (!this.currentVideoFile || this.isLoading) return;
        
        this.isLoading = true;
        try {
            const filePath = this.getAnnotationFilePath();
            if (filePath) {
                const data = await window.electronAPI.readAnnotationFile(filePath);
                if (data) {
                    this.annotations = Array.isArray(data.annotations) ? data.annotations : [];
                    this.annotations.sort((a, b) => a.time - b.time);
                    console.log(`加载了 ${this.annotations.length} 个打点`);
                } else {
                    // 文件存在但数据为空
                    this.annotations = [];
                    console.log('打点文件为空，初始化空数组');
                }
            } else {
                // 无法生成文件路径
                this.annotations = [];
                console.log('无法生成打点文件路径，初始化空数组');
            }
        } catch (error) {
            console.log('打点文件不存在或读取失败，将创建新的打点文件');
            this.annotations = [];
        } finally {
            // 无论成功还是失败，都要更新UI显示
            this.updateProgressBarAnnotations();
            this.updateOutlineView();
            this.isLoading = false;
        }
    }

    // 保存打点数据到文件
    async saveAnnotationsToFile() {
        if (!this.currentVideoFile) return false;
        
        try {
            const filePath = this.getAnnotationFilePath();
            const data = {
                videoFile: this.currentVideoFile,
                createdAt: new Date().toISOString(),
                version: "1.0",
                annotations: this.annotations
            };
            
            await window.electronAPI.writeAnnotationFile(filePath, data);
            console.log(`打点已保存到: ${filePath}`);
            return true;
        } catch (error) {
            console.error('保存打点文件失败:', error);
            return false;
        }
    }

    // 更新进度条上的打点显示
    updateProgressBarAnnotations() {
        if (!this.player) return;

        // 清除现有的打点显示
        const existingContainers = document.querySelectorAll('.annotation-container');
        existingContainers.forEach(container => container.remove());

        const duration = this.player.duration();
        if (!duration || duration <= 0) return;

        const progressContainer = document.getElementById('progress-container');
        if (!progressContainer) return;

        // 计算动态级别高度映射
        const levelHeightMap = this.calculateDynamicLevelHeights();

        // 为每个打点创建圆点
        this.annotations.forEach(annotation => {
            const dot = this.createAnnotationDot(annotation, duration, levelHeightMap);
            progressContainer.appendChild(dot);
        });
        
        // 同时更新pan-track上的缩略打点
        this.updatePanTrackAnnotations(duration);
    }

    // 更新pan-track上的缩略打点标记
    updatePanTrackAnnotations(duration) {
        const panTrack = document.querySelector('.pan-track');
        if (!panTrack || !duration || duration <= 0) return;

        // 清除现有的缩略打点
        const existingThumbnails = panTrack.querySelectorAll('.pan-annotation-thumbnail');
        existingThumbnails.forEach(thumbnail => thumbnail.remove());

        // 为每个打点创建缩略标记
        this.annotations.forEach(annotation => {
            const thumbnail = this.createPanAnnotationThumbnail(annotation, duration);
            panTrack.appendChild(thumbnail);
        });
    }

    // 创建pan-track上的缩略打点标记
    createPanAnnotationThumbnail(annotation, duration) {
        const thumbnail = document.createElement('div');
        thumbnail.className = 'pan-annotation-thumbnail';
        
        // 添加颜色类
        if (annotation.color) {
            thumbnail.classList.add(`color-${annotation.color}`);
        }
        
        // 添加级别类
        const normalizedLevel = this.normalizeLevel(annotation.level);
        if (normalizedLevel === '1') {
            thumbnail.classList.add('level-high');
        } else if (normalizedLevel === '2') {
            thumbnail.classList.add('level-medium');
        } else if (normalizedLevel === '3') {
            thumbnail.classList.add('level-low');
        } else {
            thumbnail.classList.add('level-default');
        }
        
        // 如果有时长，添加时长类并设置宽度
        if (annotation.duration && annotation.duration > 0) {
            thumbnail.classList.add('has-duration');
            const widthPercentage = (annotation.duration / duration) * 100;
            thumbnail.style.width = `${Math.max(0.1, widthPercentage)}%`; // 最小宽度0.1%
        }
        
        // 计算并设置位置（这个必须用JS动态计算）
        const percentage = (annotation.time / duration) * 100;
        thumbnail.style.left = `${percentage}%`;
        
        return thumbnail;
    }

    // 计算动态级别高度映射
    calculateDynamicLevelHeights() {
        // 收集所有存在的级别
        const existingLevels = new Set();
        this.annotations.forEach(annotation => {
            const normalizedLevel = this.normalizeLevel(annotation.level);
            if (normalizedLevel === '1') existingLevels.add(1); // 高
            else if (normalizedLevel === '2') existingLevels.add(2); // 中
            else if (normalizedLevel === '3') existingLevels.add(3); // 低
            else existingLevels.add(4); // 默认
        });

        // 如果没有打点，返回默认映射
        if (existingLevels.size === 0) {
            return { 1: 100, 2: 200, 3: 300, 4: 400 };
        }

        // 将级别按从低到高排序：4(默认) < 3(低) < 2(中) < 1(高)
        const sortedLevels = Array.from(existingLevels).sort((a, b) => b - a);
        
        // 为每个存在的级别分配连续的高度
        const levelHeightMap = {};
        sortedLevels.forEach((level, index) => {
            // 从最低级别（默认）开始，分配高度：默认 -> 100%, 低 -> 200%, 中 -> 300%, 高 -> 400%
            levelHeightMap[level] = (index + 1) * 100;
        });

        return levelHeightMap;
    }

    // 创建打点圆点元素
    createAnnotationDot(annotation, duration, levelHeightMap = null) {
        // 创建容器元素
        const container = document.createElement('div');
        let className = 'annotation-container';
        
        // 添加颜色类
        if (annotation.color) {
            className += ` color-${annotation.color}`;
        }
        
        // 不再添加CSS级别类，而是使用动态高度
        // if (annotation.level) {
        //     className += ` level-${annotation.level}`;
        // }
        
        container.className = className;
        container.dataset.annotationId = annotation.id;
        
        // 计算位置和宽度
        const percentage = (annotation.time / duration) * 100;
        container.style.left = `${percentage}%`;
        container.style.position = 'absolute';
        container.style.zIndex = '16';
        
        // 如果有时长，设置宽度；否则保持默认圆点样式
        if (annotation.duration && annotation.duration > 0) {
            const widthPercentage = (annotation.duration / duration) * 100;
            container.style.width = `${widthPercentage}%`;
            container.classList.add('has-duration');
        } else {
            const widthPercentage = 0;
            container.style.width = `${widthPercentage}%`;
            container.classList.remove('has-duration');
        }
        
        // 创建圆点或条形
        const dot = document.createElement('div');
        dot.className = 'annotation-dot';
        dot.style.cursor = 'pointer';
        dot.style.transition = 'all 0.3s ease';
        dot.style.position = 'relative';
        
        // 创建标题容器（用于定位popup，不设置overflow限制）
        const title = document.createElement('div');
        title.className = 'annotation-title';
        
        
        // 应用动态高度
        if (levelHeightMap) {
            const normalizedLevel = this.normalizeLevel(annotation.level);
            let levelKey;
            if (normalizedLevel === '1') levelKey = 1; // 高
            else if (normalizedLevel === '2') levelKey = 2; // 中
            else if (normalizedLevel === '3') levelKey = 3; // 低
            else levelKey = 4; // 默认
            
            const heightPercent = levelHeightMap[levelKey] || 100;
            
            title.style.transform = `translateX(-50%) translateY(-${heightPercent}%)`;
        } else {
            // 默认转换（向后兼容）
            title.style.transform = 'translateX(-50%) translateY(-100%)';
        }
        
        // 创建标题文本容器（处理文本溢出）
        const titleText = document.createElement('div');
        titleText.textContent = annotation.title || '';
        titleText.style.padding = '2px 6px';
        titleText.style.fontSize = '10px';
        titleText.style.fontWeight = '500';
        titleText.style.whiteSpace = 'nowrap';
        titleText.style.maxWidth = '80px';
        titleText.style.overflow = 'hidden';
        titleText.style.textOverflow = 'ellipsis';
        
        // 如果没有标题，隐藏标题文本但保持可交互性
        if (!annotation.title) {
            titleText.style.opacity = '0';
            // 对于annotation-title容器，设置透明背景和边框
            title.style.background = 'transparent';
            title.style.border = 'transparent';
            title.style.backdropFilter = 'none';
            // 保持 pointer events 以便hover触发popup
        }
        
        // 创建popup元素并添加到标题容器内
        const popup = this.createPopupElement(annotation);
        
        title.appendChild(titleText);
        title.appendChild(popup);
        
        container.appendChild(title);
        container.appendChild(dot);

        // 圆点缩放效果（通过CSS hover处理popup显示）
        container.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        container.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
        });

        container.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
        });

        // 点击跳转
        container.addEventListener('click', (e) => {
            e.stopPropagation();
            this.jumpToAnnotation(annotation.id);
        });

        // 初始化播放状态
        if (this.player && typeof window.updateElementPlayedStatus === 'function') {
            const currentTime = this.player.currentTime();
            window.updateElementPlayedStatus(container, annotation, currentTime);
        }

        return container;
    }

    // 创建popup元素
    createPopupElement(annotation) {
        const popup = document.createElement('div');
        popup.className = 'annotation-popup';
        
        // 获取颜色配置
        const colorConfig = this.getColorConfig(annotation.color);
        const textColor = annotation.color === 'yellow' ? '#000' : 'white';
        
        // 生成时间信息（包含时长）
        const timeInfo = annotation.duration && annotation.duration > 0 
            ? `${this.formatTime(annotation.time)} ~ ${this.formatTime(annotation.time + annotation.duration)} (${this.formatTime(annotation.duration)})`
            : this.formatTime(annotation.time);
        
        popup.innerHTML = `
            <div class="annotation-popup-content">
                <div class="annotation-time" style="color: ${colorConfig.primary};">${timeInfo}</div>
                ${annotation.title ? `<div class="annotation-popup-title">${this.escapeHtml(annotation.title)}</div>` : ''}
                ${annotation.text ? `<div class="annotation-text">${this.escapeHtml(annotation.text)}</div>` : ''}
                ${!annotation.title && !annotation.text ? `<div class="annotation-empty">空白打点</div>` : ''}
                <div class="annotation-actions">
                    <button class="popup-icon-btn edit-btn" data-id="${annotation.id}" title="编辑打点">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708L10.5 8.207l-3-3L12.146.146zM11.207 9l2-2L14.5 8.293a.25.25 0 0 0 .177-.427L13.354 6.543a.25.25 0 0 0-.427.177L11.207 9z"/>
                            <path d="M4.5 11.5A.5.5 0 0 1 5 11h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 1 1 0v.5a.5.5 0 0 1 .5.5zM3 10.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/>
                            <path d="M9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0z"/>
                        </svg>
                    </button>
                    <button class="popup-icon-btn delete-btn" data-id="${annotation.id}" title="删除打点">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        
        // popup整体点击事件 - 进入编辑窗口
        popup.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡到进度条
            // 如果点击的是按钮，不触发popup的编辑功能
            if (e.target.closest('.popup-icon-btn')) {
                return;
            }
            this.showAnnotationDetailModal(annotation.id);
        });

        // 阻止popup的其他鼠标事件冒泡到进度条
        popup.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        popup.addEventListener('mousemove', (e) => {
            e.stopPropagation();
        });

        popup.addEventListener('mouseup', (e) => {
            e.stopPropagation();
        });

        // 绑定编辑按钮事件
        const editBtn = popup.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showAnnotationDetailModal(annotation.id);
            });
            // 阻止按钮的其他鼠标事件
            editBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            editBtn.addEventListener('mouseup', (e) => e.stopPropagation());
        }

        // 绑定删除按钮事件
        const deleteBtn = popup.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('确定要删除这个打点吗？')) {
                    await this.deleteAnnotation(annotation.id);
                }
            });
            // 阻止按钮的其他鼠标事件
            deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
            deleteBtn.addEventListener('mouseup', (e) => e.stopPropagation());
        }
        
        return popup;
    }

    // 显示打点预览popup（已弃用，保留兼容性）
    showAnnotationPopup(annotation, x, y) {
        this.hideAnnotationPopup(); // 先隐藏现有popup

        const popup = document.createElement('div');
        popup.className = 'annotation-popup';
        popup.innerHTML = `
            <div class="annotation-popup-content">
                <div class="annotation-time">${this.formatTime(annotation.time)}</div>
                ${annotation.title ? `<div class="annotation-popup-title">${this.escapeHtml(annotation.title)}</div>` : ''}
                ${annotation.text ? `<div class="annotation-text">${this.escapeHtml(annotation.text)}</div>` : ''}
                ${!annotation.title && !annotation.text ? `<div class="annotation-empty">空白打点</div>` : ''}
                <div class="annotation-actions">
                    <button class="popup-btn view-btn" data-id="${annotation.id}">查看详情</button>
                </div>
            </div>
        `;

        // 设置popup样式
        popup.style.position = 'fixed';
        popup.style.left = x + 'px';
        popup.style.top = (y - 10) + 'px';
        popup.style.transform = 'translate(-50%, -100%)';
        popup.style.background = 'rgba(0,0,0,0.3)';
        popup.style.color = 'white';
        popup.style.padding = '12px';
        popup.style.borderRadius = '8px';
        popup.style.fontSize = '12px';
        popup.style.zIndex = '1000';
        popup.style.maxWidth = '250px';
        popup.style.border = '1px solid rgba(255,255,255,0.3)';
        popup.style.backdropFilter = 'blur(15px)';
        popup.style.webkitBackdropFilter = 'blur(1px)';
        popup.style.pointerEvents = 'auto';

        // 获取颜色配置
        const colorConfig = this.getColorConfig(annotation.color);
        const textColor = annotation.color === 'yellow' ? '#000' : 'white';

        // 添加样式到popup内容
        const style = document.createElement('style');
        style.textContent = `
            .annotation-popup-content .annotation-time {
                color: ${colorConfig.primary};
                font-weight: bold;
                margin-bottom: 6px;
            }
            .annotation-popup-content .annotation-popup-title {
                color: white;
                font-weight: 600;
                margin-bottom: 6px;
                font-size: 13px;
            }
            .annotation-popup-content .annotation-text {
                margin-bottom: 8px;
                line-height: 1.4;
                color: rgba(255,255,255,0.9);
            }
            .annotation-popup-content .annotation-empty {
                margin-bottom: 8px;
                line-height: 1.4;
                color: rgba(255,255,255,0.6);
                font-style: italic;
                font-size: 12px;
            }
            .annotation-popup-content .popup-btn {
                background: rgba(${colorConfig.rgba},0.8);
                color: ${textColor};
                border: none;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                transition: background 0.2s ease;
            }
            .annotation-popup-content .popup-btn:hover {
                background: rgba(${colorConfig.rgba},1);
            }
        `;
        popup.appendChild(style);

        // 绑定查看详情按钮事件
        const viewBtn = popup.querySelector('.view-btn');
        if (viewBtn) {
            viewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showAnnotationDetailModal(annotation.id);
                this.hideAnnotationPopup();
            });
        }

        // 添加popup的鼠标事件处理
        popup.addEventListener('mouseenter', () => {
            // 鼠标进入popup时，取消隐藏
            this.cancelHidePopup();
        });

        popup.addEventListener('mouseleave', () => {
            // 鼠标离开popup时，安排隐藏
            this.scheduleHidePopup();
        });

        document.body.appendChild(popup);
        
        // 设置自动隐藏（增加时间到8秒，给用户更多时间）
        setTimeout(() => {
            if (popup.parentNode) {
                this.hideAnnotationPopup();
            }
        }, 8000);
    }

    // 安排延迟隐藏popup
    scheduleHidePopup() {
        // 清除之前的定时器
        if (this.hidePopupTimer) {
            clearTimeout(this.hidePopupTimer);
        }
        
        // 设置延迟隐藏（200ms后隐藏，给用户足够时间移动鼠标到popup）
        this.hidePopupTimer = setTimeout(() => {
            this.hideAnnotationPopup();
        }, 200);
    }

    // 取消隐藏popup
    cancelHidePopup() {
        if (this.hidePopupTimer) {
            clearTimeout(this.hidePopupTimer);
            this.hidePopupTimer = null;
        }
    }

    // 隐藏打点popup
    hideAnnotationPopup() {
        const existingPopup = document.querySelector('.annotation-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        // 清除定时器
        if (this.hidePopupTimer) {
            clearTimeout(this.hidePopupTimer);
            this.hidePopupTimer = null;
        }
    }

    // 显示打点编辑模态框（统一用于新建和编辑）
    showAnnotationModal(currentTime, annotation = null) {
        const isEdit = annotation !== null;
        const modalTitle = isEdit ? `编辑打点 - ${this.formatTime(annotation.time)}` : `添加打点 - ${this.formatTime(currentTime)}`;
        
        // 获取默认值
        const defaultTitle = isEdit ? annotation.title : '';
        const defaultText = isEdit ? annotation.text : '';
        const defaultColor = isEdit ? (annotation.color === 'gray' ? 'blue' : annotation.color || 'blue') : 'blue';
        // 获取规范化的level值用于显示
        const normalizedLevel = isEdit ? this.normalizeLevel(annotation.level) : null;
        const defaultLevel = normalizedLevel || '';
        const defaultDuration = isEdit ? annotation.duration || '' : '';
        
        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'annotation-input-modal';
        modal.tabIndex = 0; // 让模态框本身可以获取焦点
        modal.innerHTML = `
            <div class="annotation-input-overlay"></div>
            <div class="annotation-input-content">
                <div class="annotation-input-header">
                    <h3>${modalTitle}</h3>
                    <button class="annotation-input-close">&times;</button>
                </div>
                <div class="annotation-input-body">
                    <div class="annotation-input-field">
                        <label class="annotation-input-label">打点标题（可选）</label>
                        <input 
                            type="text" 
                            id="annotation-input-title" 
                            class="annotation-input-field-input"
                            placeholder="请输入打点标题..."
                            maxlength="50"
                            value="${this.escapeHtml(defaultTitle)}"
                        />
                    </div>
                    <div class="annotation-input-field">
                        <label class="annotation-input-label">打点内容（可选）</label>
                        <textarea 
                            id="annotation-input-text" 
                            class="annotation-input-textarea"
                            placeholder="请输入打点内容..."
                            rows="4"
                        >${this.escapeHtml(defaultText)}</textarea>
                    </div>
                    <div class="annotation-input-field">
                        <label class="annotation-input-label">时长（秒，可选）</label>
                        <input 
                            type="number" 
                            id="annotation-input-duration" 
                            class="annotation-input-field-input"
                            placeholder="请输入时长（秒）..."
                            min="0"
                            step="0.1"
                            value="${defaultDuration}"
                        />
                        <small style="color: rgba(255,255,255,0.6); font-size: 11px; margin-top: 4px; display: block;">
                            设置时长后，打点会显示为时间段；不设置则显示为时间点
                        </small>
                    </div>
                    <div class="annotation-input-row annotation-options-row">
                        <div class="annotation-input-field">
                            <label class="annotation-input-label">颜色</label>
                            <div class="annotation-color-group" tabindex="0" role="radiogroup" aria-label="选择颜色">
                                <input type="radio" id="color-blue" name="annotation-color" value="blue" ${defaultColor === 'blue' || defaultColor === 'gray' || !defaultColor ? 'checked' : ''} tabindex="-1">
                                <label for="color-blue" class="color-button color-blue" title="蓝色（默认）"></label>
                                
                                <input type="radio" id="color-red" name="annotation-color" value="red" ${defaultColor === 'red' ? 'checked' : ''} tabindex="-1">
                                <label for="color-red" class="color-button color-red" title="红色"></label>
                                
                                <input type="radio" id="color-orange" name="annotation-color" value="orange" ${defaultColor === 'orange' ? 'checked' : ''} tabindex="-1">
                                <label for="color-orange" class="color-button color-orange" title="橙色"></label>
                                
                                <input type="radio" id="color-yellow" name="annotation-color" value="yellow" ${defaultColor === 'yellow' ? 'checked' : ''} tabindex="-1">
                                <label for="color-yellow" class="color-button color-yellow" title="黄色"></label>
                                
                                <input type="radio" id="color-green" name="annotation-color" value="green" ${defaultColor === 'green' ? 'checked' : ''} tabindex="-1">
                                <label for="color-green" class="color-button color-green" title="绿色"></label>
                                
                                <input type="radio" id="color-purple" name="annotation-color" value="purple" ${defaultColor === 'purple' ? 'checked' : ''} tabindex="-1">
                                <label for="color-purple" class="color-button color-purple" title="紫色"></label>
                            </div>
                        </div>
                        <div class="annotation-input-field">
                            <label class="annotation-input-label">级别</label>
                            <div class="annotation-level-group" tabindex="0" role="radiogroup" aria-label="选择级别">
                                <input type="radio" id="level-high" name="annotation-level" value="1" ${defaultLevel === '1' ? 'checked' : ''} tabindex="-1">
                                <label for="level-high" class="level-button">高</label>
                                
                                <input type="radio" id="level-medium" name="annotation-level" value="2" ${defaultLevel === '2' ? 'checked' : ''} tabindex="-1">
                                <label for="level-medium" class="level-button">中</label>
                                
                                <input type="radio" id="level-low" name="annotation-level" value="3" ${defaultLevel === '3' ? 'checked' : ''} tabindex="-1">
                                <label for="level-low" class="level-button">低</label>
                                
                                <input type="radio" id="level-default" name="annotation-level" value="" ${defaultLevel === '' ? 'checked' : ''} tabindex="-1">
                                <label for="level-default" class="level-button">默认</label>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="annotation-input-footer">
                    ${isEdit ? '<button class="annotation-input-btn annotation-input-btn-danger" id="annotation-delete-btn">删除打点</button>' : ''}
                    <button class="annotation-input-btn annotation-input-btn-save">${isEdit ? '保存修改' : '保存打点'}</button>
                </div>
            </div>
        `;

        // 事件监听
        const closeBtn = modal.querySelector('.annotation-input-close');
        const overlay = modal.querySelector('.annotation-input-overlay');
        const saveBtn = modal.querySelector('.annotation-input-btn-save');
        const deleteBtn = modal.querySelector('#annotation-delete-btn');
        const titleInput = modal.querySelector('#annotation-input-title');
        const textArea = modal.querySelector('#annotation-input-text');
        const durationInput = modal.querySelector('#annotation-input-duration');
        const colorSelect = modal.querySelector('#annotation-input-color');
        const levelSelect = modal.querySelector('#annotation-input-level');

        const closeModal = () => {
            // 清理焦点陷阱事件监听器
            if (modal._focusTrapCleanup) {
                modal._focusTrapCleanup.forEach(cleanup => cleanup());
                modal._focusTrapCleanup = null;
            }
            // 清理模态框快捷键事件监听器
            if (modal._modalShortcutsCleanup) {
                modal._modalShortcutsCleanup.forEach(cleanup => cleanup());
                modal._modalShortcutsCleanup = null;
            }
            modal.remove();
        };

        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', closeModal);

        // 点击模态框内容区域时，让模态框获取焦点（确保快捷键能工作）
        const modalContent = modal.querySelector('.annotation-input-content');
        modalContent.addEventListener('click', (e) => {
            // 如果点击的不是输入元素，则让模态框获取焦点
            const clickedElement = e.target;
            const isInputElement = clickedElement.tagName === 'INPUT' || 
                                 clickedElement.tagName === 'TEXTAREA' || 
                                 clickedElement.tagName === 'BUTTON' ||
                                 clickedElement.closest('.annotation-color-group') ||
                                 clickedElement.closest('.annotation-level-group');
            
            if (!isInputElement) {
                modal.focus();
            }
        });

        // 删除按钮（仅编辑时显示）
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                if (confirm('确定要删除这个打点吗？')) {
                    await this.deleteAnnotation(annotation.id);
                    closeModal();
                }
            });
        }

        // 保存打点
        saveBtn.addEventListener('click', async () => {
            const title = titleInput.value.trim();
            const text = textArea.value.trim();
            const duration = durationInput.value ? parseFloat(durationInput.value) : null;
            const colorRadio = document.querySelector('input[name="annotation-color"]:checked');
            const levelRadio = document.querySelector('input[name="annotation-level"]:checked');
            const color = colorRadio ? colorRadio.value : 'blue';
            // 规范化level值：空字符串表示默认级别
            const rawLevel = levelRadio ? levelRadio.value : '';
            const level = rawLevel === '' ? null : rawLevel;
            
            if (isEdit) {
                // 编辑模式
                await this.editAnnotation(annotation.id, title, text, color, level, duration);
            } else {
                // 新建模式
                const newAnnotation = await this.addAnnotation(currentTime, title, text, color, level, duration);
                if (newAnnotation) {
                    console.log('打点已添加:', newAnnotation);
                }
            }
            closeModal();
        });

        // ESC键关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // 获取radio group元素
        const colorGroup = modal.querySelector('.annotation-color-group');
        const levelGroup = modal.querySelector('.annotation-level-group');

        // 添加模态框快捷键支持
        this.setupModalShortcuts(modal, colorGroup, levelGroup);

        // 添加键盘导航支持
        this.setupRadioGroupNavigation(modal);

        // 设置颜色同步
        this.setupColorSync(modal, colorGroup, levelGroup);

        // 阻止模态框内的按键事件冒泡到视频界面
        this.setupModalKeyboardIsolation(modal);

        // 设置焦点陷阱
        this.setupFocusTrap(modal);

        document.body.appendChild(modal);
        
        // 自动聚焦到标题输入框，如果失败则让模态框获取焦点
        setTimeout(() => {
            if (titleInput) {
                titleInput.focus();
            } else {
                modal.focus();
            }
        }, 100);
    }

    // 显示添加打点的输入模态框（保持兼容性）
    showAddAnnotationModal(currentTime) {
        this.showAnnotationModal(currentTime);
    }



    // 显示打点详情模态框（重定向到统一方法）
    showAnnotationDetailModal(annotationId) {
        const annotation = this.annotations.find(ann => ann.id === annotationId);
        if (!annotation) return;
        
        this.showAnnotationModal(annotation.time, annotation);
    }

    // 旧的详情模态框代码（已弃用）
    _showOldAnnotationDetailModal(annotationId) {
        const annotation = this.annotations.find(ann => ann.id === annotationId);
        if (!annotation) return;

        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'annotation-modal';
        modal.innerHTML = `
            <div class="annotation-modal-overlay"></div>
            <div class="annotation-modal-content">
                <div class="annotation-modal-header">
                    <h3>打点详情</h3>
                    <button class="annotation-modal-close">&times;</button>
                </div>
                <div class="annotation-modal-body">
                    <div class="annotation-detail-item">
                        <label>时间位置:</label>
                        <span>${this.formatTime(annotation.time)}</span>
                    </div>
                    <div class="annotation-detail-item">
                        <label>打点标题:</label>
                        <input type="text" id="annotation-edit-title" value="${this.escapeHtml(annotation.title)}" placeholder="请输入打点标题..." maxlength="50" />
                    </div>
                    <div class="annotation-detail-item">
                        <label>打点内容:</label>
                        <textarea id="annotation-edit-text" rows="4" placeholder="请输入打点内容...">${this.escapeHtml(annotation.text)}</textarea>
                    </div>
                    <div class="annotation-detail-item">
                        <label>创建时间:</label>
                        <span>${new Date(annotation.createdAt).toLocaleString()}</span>
                    </div>
                    ${annotation.updatedAt ? `
                        <div class="annotation-detail-item">
                            <label>更新时间:</label>
                            <span>${new Date(annotation.updatedAt).toLocaleString()}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="annotation-modal-footer">
                    <button class="annotation-btn annotation-btn-secondary" id="annotation-jump-btn">跳转到此时间</button>
                    <button class="annotation-btn annotation-btn-danger" id="annotation-delete-btn">删除打点</button>
                    <button class="annotation-btn annotation-btn-primary" id="annotation-save-btn">保存修改</button>
                </div>
            </div>
        `;

        // 添加模态框样式
        this.addModalStyles();

        // 事件监听
        const closeBtn = modal.querySelector('.annotation-modal-close');
        const overlay = modal.querySelector('.annotation-modal-overlay');
        const jumpBtn = modal.querySelector('#annotation-jump-btn');
        const deleteBtn = modal.querySelector('#annotation-delete-btn');
        const saveBtn = modal.querySelector('#annotation-save-btn');
        const titleInput = modal.querySelector('#annotation-edit-title');
        const textArea = modal.querySelector('#annotation-edit-text');

        const closeModal = () => modal.remove();

        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', closeModal);
        
        jumpBtn.addEventListener('click', () => {
            this.jumpToAnnotation(annotationId);
            closeModal();
        });

        deleteBtn.addEventListener('click', async () => {
            if (confirm('确定要删除这个打点吗？')) {
                await this.deleteAnnotation(annotationId);
                closeModal();
            }
        });

        saveBtn.addEventListener('click', async () => {
            const newTitle = titleInput.value.trim();
            const newText = textArea.value.trim();
            
            // 如果标题或内容有变化，则保存（允许两者都为空）
            if (newTitle !== annotation.title || newText !== annotation.text) {
                await this.editAnnotation(annotationId, newTitle, newText);
            }
            closeModal();
        });

        // ESC键关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(modal);
    }

    // 添加模态框样式
    addModalStyles() {
        if (document.querySelector('#annotation-modal-styles')) return;

        const style = document.createElement('style');
        style.id = 'annotation-modal-styles';
        style.textContent = `
            .annotation-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 2000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .annotation-modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.7);
                backdrop-filter: blur(5px);
            }
            .annotation-modal-content {
                position: relative;
                background: rgba(20,20,20,0.95);
                border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.2);
                min-width: 400px;
                max-width: 600px;
                max-height: 80vh;
                overflow: hidden;
                backdrop-filter: blur(20px);
            }
            .annotation-modal-header {
                padding: 20px 24px 0 24px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255,255,255,0.1);
                padding-bottom: 16px;
                margin-bottom: 20px;
            }
            .annotation-modal-header h3 {
                margin: 0;
                color: white;
                font-size: 18px;
                font-weight: 600;
            }
            .annotation-modal-close {
                background: none;
                border: none;
                color: rgba(255,255,255,0.6);
                font-size: 24px;
                cursor: pointer;
                padding: 0;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s ease;
            }
            .annotation-modal-close:hover {
                background: rgba(255,255,255,0.1);
                color: white;
            }
            .annotation-modal-body {
                padding: 0 24px;
                max-height: 50vh;
                overflow-y: auto;
            }
            .annotation-detail-item {
                margin-bottom: 16px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .annotation-detail-item label {
                color: rgba(255,255,255,0.8);
                font-size: 12px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .annotation-detail-item span {
                color: white;
                font-size: 14px;
            }
            .annotation-detail-item input[type="text"] {
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 6px;
                color: white;
                padding: 10px 12px;
                font-size: 14px;
                font-family: inherit;
                width: 100%;
                box-sizing: border-box;
            }
            .annotation-detail-item input[type="text"]:focus {
                outline: none;
                border-color: #28a745;
                background: rgba(255,255,255,0.15);
            }
            .annotation-detail-item input[type="text"]::placeholder {
                color: rgba(255,255,255,0.4);
            }
            .annotation-detail-item textarea {
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 6px;
                color: white;
                padding: 12px;
                font-size: 14px;
                font-family: inherit;
                resize: vertical;
                min-height: 80px;
                width: 100%;
                box-sizing: border-box;
            }
            .annotation-detail-item textarea:focus {
                outline: none;
                border-color: #28a745;
                background: rgba(255,255,255,0.15);
            }
            .annotation-detail-item textarea::placeholder {
                color: rgba(255,255,255,0.4);
            }
            .annotation-modal-footer {
                padding: 20px 24px;
                border-top: 1px solid rgba(255,255,255,0.1);
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }
            .annotation-btn {
                padding: 10px 16px;
                border: none;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .annotation-btn-primary {
                background: #28a745;
                color: white;
            }
            .annotation-btn-primary:hover {
                background: #218838;
            }
            .annotation-btn-secondary {
                background: rgba(255,255,255,0.1);
                color: white;
            }
            .annotation-btn-secondary:hover {
                background: rgba(255,255,255,0.2);
            }
            .annotation-btn-danger {
                background: #dc3545;
                color: white;
            }
            .annotation-btn-danger:hover {
                background: #c82333;
            }
        `;
        document.head.appendChild(style);
    }

    // 格式化时间显示
    formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    }

    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 获取颜色配置
    getColorConfig(color = 'blue') {
        const colors = {
            red: { primary: '#dc3545', rgba: '220, 53, 69' },
            orange: { primary: '#fd7e14', rgba: '253, 126, 20' },
            yellow: { primary: '#ffc107', rgba: '255, 193, 7' },
            green: { primary: '#28a745', rgba: '40, 167, 69' },
            blue: { primary: '#007bff', rgba: '0, 123, 255' },
            purple: { primary: '#6f42c1', rgba: '111, 66, 193' }
        };
        return colors[color] || colors.blue;
    }

    // 设置radio group的键盘导航
    setupRadioGroupNavigation(modal) {
        const colorGroup = modal.querySelector('.annotation-color-group');
        const levelGroup = modal.querySelector('.annotation-level-group');

        [colorGroup, levelGroup].forEach(group => {
            if (!group) return;

            const radios = group.querySelectorAll('input[type="radio"]');
            
            // 键盘事件监听
            group.addEventListener('keydown', (e) => {
                // 如果是Ctrl+Enter或Cmd+Enter，让事件继续冒泡以便触发保存
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    return; // 不阻止事件，让它冒泡到外层的保存处理器
                }
                
                // 如果是Alt+箭头键，让事件继续冒泡到模态框快捷键处理器
                if (e.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    return; // 不阻止事件，让它冒泡到模态框快捷键处理器
                }
                
                const currentChecked = group.querySelector('input[type="radio"]:checked');
                const radioArray = Array.from(radios);
                const currentIndex = currentChecked ? radioArray.indexOf(currentChecked) : 0;
                
                let newIndex = currentIndex;
                
                switch(e.key) {
                    case 'ArrowLeft':
                    case 'ArrowUp':
                        e.preventDefault();
                        newIndex = currentIndex > 0 ? currentIndex - 1 : radioArray.length - 1;
                        break;
                    case 'ArrowRight':
                    case 'ArrowDown':
                        e.preventDefault();
                        newIndex = currentIndex < radioArray.length - 1 ? currentIndex + 1 : 0;
                        break;
                    case ' ':
                    case 'Enter':
                        e.preventDefault();
                        if (currentChecked) {
                            currentChecked.click();
                        }
                        return;
                    default:
                        return;
                }
                
                // 选中新的radio按钮
                radioArray[newIndex].checked = true;
                radioArray[newIndex].dispatchEvent(new Event('change', { bubbles: true }));
            });

            // 聚焦时高亮当前选中项
            group.addEventListener('focus', () => {
                group.classList.add('focused');
            });

            group.addEventListener('blur', () => {
                group.classList.remove('focused');
            });
        });
    }

    // 切换radio选项的通用方法
    switchRadioOption(group, direction, enableCycle = true) {
        const radios = Array.from(group.querySelectorAll('input[type="radio"]'));
        const currentChecked = group.querySelector('input[type="radio"]:checked');
        
        if (radios.length === 0) return;
        
        let currentIndex = currentChecked ? radios.indexOf(currentChecked) : 0;
        let newIndex;
        
        if (direction > 0) {
            // 向下/向右：下一个选项
            if (enableCycle) {
                newIndex = currentIndex < radios.length - 1 ? currentIndex + 1 : 0;
            } else {
                newIndex = Math.min(currentIndex + 1, radios.length - 1);
            }
        } else {
            // 向上/向左：上一个选项
            if (enableCycle) {
                newIndex = currentIndex > 0 ? currentIndex - 1 : radios.length - 1;
            } else {
                newIndex = Math.max(currentIndex - 1, 0);
            }
        }
        
        // 如果索引没有变化（已到边界且不循环），则不执行切换
        if (newIndex === currentIndex && !enableCycle) {
            return;
        }
        
        // 选中新的radio按钮
        radios[newIndex].checked = true;
        radios[newIndex].dispatchEvent(new Event('change', { bubbles: true }));
        
        // 给一个简短的视觉反馈
        const label = group.querySelector(`label[for="${radios[newIndex].id}"]`);
        if (label) {
            label.style.transform = 'scale(1.05)';
            setTimeout(() => {
                label.style.transform = '';
            }, 150);
        }
    }

    // 设置模态框快捷键
    setupModalShortcuts(modal, colorGroup, levelGroup) {
        const saveBtn = modal.querySelector('.annotation-input-btn-save');
        
        const handleModalShortcuts = (e) => {
            // Ctrl+Enter或Cmd+Enter保存
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (saveBtn) {
                    saveBtn.click();
                }
                return;
            }

            // Alt+箭头键切换选项
            if (e.altKey) {
                switch(e.key) {
                    case 'ArrowUp':
                    case 'ArrowDown':
                        // Alt+上下箭头切换level（上箭头=向后，下箭头=向前，不循环）
                        if (levelGroup) {
                            e.preventDefault();
                            e.stopPropagation();
                            this.switchRadioOption(levelGroup, e.key === 'ArrowUp' ? -1 : 1, false);
                        }
                        break;
                        
                    case 'ArrowLeft':
                    case 'ArrowRight':
                        // Alt+左右箭头切换color（循环）
                        if (colorGroup) {
                            e.preventDefault();
                            e.stopPropagation();
                            this.switchRadioOption(colorGroup, e.key === 'ArrowLeft' ? -1 : 1, true);
                        }
                        break;
                }
            }
        };

        // 在模态框上添加事件监听器
        modal.addEventListener('keydown', handleModalShortcuts);

        // 存储清理函数
        if (!modal._modalShortcutsCleanup) {
            modal._modalShortcutsCleanup = [];
        }
        modal._modalShortcutsCleanup.push(() => {
            modal.removeEventListener('keydown', handleModalShortcuts);
        });
    }

    // 设置焦点陷阱，让Tab键只在模态框内循环
    setupFocusTrap(modal) {
        // 获取模态框内所有可聚焦的元素
        const getFocusableElements = () => {
            const focusableSelectors = [
                'input:not([disabled]):not([tabindex="-1"])',
                'textarea:not([disabled]):not([tabindex="-1"])',
                'button:not([disabled]):not([tabindex="-1"])',
                'select:not([disabled]):not([tabindex="-1"])',
                '[tabindex]:not([tabindex="-1"])',
                'a[href]'
            ].join(', ');
            
            return Array.from(modal.querySelectorAll(focusableSelectors))
                .filter(el => {
                    // 过滤掉不可见的元素
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                });
        };

        // Tab键处理函数
        const handleTabKey = (e) => {
            if (e.key !== 'Tab') return;

            const focusableElements = getFocusableElements();
            if (focusableElements.length === 0) return;

            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];
            const currentElement = document.activeElement;

            if (e.shiftKey) {
                // Shift+Tab - 向前循环
                if (currentElement === firstElement || !focusableElements.includes(currentElement)) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                // Tab - 向后循环
                if (currentElement === lastElement || !focusableElements.includes(currentElement)) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };

        // 添加事件监听器
        modal.addEventListener('keydown', handleTabKey);

        // 存储清理函数到模态框对象上，以便后续清理
        if (!modal._focusTrapCleanup) {
            modal._focusTrapCleanup = [];
        }
        modal._focusTrapCleanup.push(() => {
            modal.removeEventListener('keydown', handleTabKey);
        });
    }

    // 设置颜色同步：当颜色组变化时，同步更新级别组的颜色
    setupColorSync(modal, colorGroup, levelGroup) {
        if (!colorGroup || !levelGroup) return;

        // 更新level-group的颜色类名
        const updateLevelGroupColor = () => {
            const checkedColor = colorGroup.querySelector('input[type="radio"]:checked');
            if (!checkedColor) return;

            const colorValue = checkedColor.value;
            
            // 移除所有现有的颜色类
            const colorClasses = ['color-red', 'color-orange', 'color-yellow', 'color-green', 'color-blue', 'color-purple'];
            colorClasses.forEach(cls => levelGroup.classList.remove(cls));
            
            // 添加当前选中的颜色类
            if (colorValue) {
                levelGroup.classList.add(`color-${colorValue}`);
            }
        };

        // 监听颜色组的变化
        colorGroup.addEventListener('change', updateLevelGroupColor);

        // 初始化时也更新一次
        updateLevelGroupColor();
    }

    // 设置模态框的键盘事件隔离
    setupModalKeyboardIsolation(modal) {
        // 需要阻止冒泡的按键列表（对应视频播放器的快捷键）
        const videoShortcutKeys = [
            'Space',           // 播放/暂停
            'ArrowLeft',       // 快退
            'ArrowRight',      // 快进
            'ArrowUp',         // 音量+
            'ArrowDown',       // 音量-
            'KeyF',            // 全屏
            'KeyM',            // 静音
            'Enter'            // 添加打点（避免重复触发）
        ];

        // 在模态框上添加keydown事件监听器来阻止冒泡
        modal.addEventListener('keydown', (e) => {
            // 如果是视频快捷键，阻止事件冒泡
            if (videoShortcutKeys.includes(e.code)) {
                e.stopPropagation();
                
                // 对于某些特殊键，还需要阻止默认行为
                if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
                    // 但是要允许在文本框中的正常使用
                    const target = e.target;
                    const isInInputField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
                    
                    if (!isInInputField) {
                        e.preventDefault();
                    }
                }
            }
        });

        // 同时阻止keyup事件冒泡（某些快捷键可能在keyup时触发）
        modal.addEventListener('keyup', (e) => {
            if (videoShortcutKeys.includes(e.code)) {
                e.stopPropagation();
            }
        });

        // 阻止keypress事件冒泡
        modal.addEventListener('keypress', (e) => {
            // 对于字符键，检查是否是快捷键相关的
            if (e.key === ' ' || e.key === 'f' || e.key === 'm') {
                e.stopPropagation();
            }
        });
    }

    // 更新大纲视图
    updateOutlineView() {
        // 检查是否存在renderer.js中定义的updateOutlineView函数
        if (typeof window.updateOutlineView === 'function') {
            window.updateOutlineView();
        }
    }
}

// 创建全局打点管理器实例
window.annotationManager = new AnnotationManager();
