/**
 * 标记播放器组件 - MarkerPlayer
 * 用于根据视频播放进度显示对应的标记
 */
class MarkerPlayer {
    constructor(container) {
        this.container = container;
        this.overlay = null;
        this.currentMarkers = new Map(); // 当前显示的标记
        this.annotations = []; // 打点数据
        this.currentTime = 0; // 当前播放时间
        
        // 性能优化相关
        this.intervalTree = null; // 区间树结构
        this.useIntervalTree = false; // 是否使用区间树优化
        
        this.init();
    }
    
    init() {
        this.createOverlay();
        this.setupOverlayProperties();
    }
    
    // 创建播放器覆盖层
    createOverlay() {
        this.overlay = document.getElementById('marker-player-overlay');
        if (!this.overlay) {
            console.error('MarkerPlayer: 未找到marker-player-overlay元素');
            return;
        }
    }
    
    // 设置覆盖层属性（复用VideoMarker的逻辑）
    setupOverlayProperties() {
        if (!this.overlay) return;
        
        // 获取视频元素
        const video = this.container.querySelector('video');
        if (video) {
            this.adjustOverlayToVideo(video);
            
            // 监听视频元数据变化
            video.addEventListener('loadedmetadata', () => {
                this.adjustOverlayToVideo(video);
            });
        }
        
        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            setTimeout(() => {
                if (this.overlay) {
                    this.updateOverlaySize();
                    this.updateFontSize();
                }
            }, 100);
        });
    }
    
    // 调整覆盖层以匹配视频实际尺寸（复用VideoMarker的逻辑）
    adjustOverlayToVideo(video) {
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;
        
        if (videoWidth && videoHeight) {
            const videoAspectRatio = videoWidth / videoHeight;
            
            // 获取容器的实际尺寸
            const containerRect = this.container.getBoundingClientRect();
            const containerAspectRatio = containerRect.width / containerRect.height;
            
            // 设置视频的宽高比
            this.overlay.style.setProperty('aspect-ratio', `${videoWidth} / ${videoHeight}`);
            
            // 根据容器与视频的宽高比关系，动态设置宽度或高度为auto
            if (containerAspectRatio > videoAspectRatio) {
                this.overlay.style.width = 'auto';
                this.overlay.style.height = '100%';
            } else {
                this.overlay.style.width = '100%';
                this.overlay.style.height = 'auto';
            }
            
            // 更新字体大小
            setTimeout(() => {
                this.updateFontSize();
            }, 10);
        }
    }
    
    // 更新覆盖层尺寸
    updateOverlaySize() {
        const video = this.container.querySelector('video');
        if (video) {
            this.adjustOverlayToVideo(video);
        }
    }
    
    // 更新字体大小
    updateFontSize() {
        if (!this.overlay) return;
        
        const overlayRect = this.overlay.getBoundingClientRect();
        const actualVideoHeight = overlayRect.height;
        
        if (actualVideoHeight > 0) {
            // 计算字体大小：视频高度的1.4%（与编辑器保持一致）
            const fontSize = actualVideoHeight * 0.024;
            this.overlay.style.fontSize = `${fontSize}px`;
        }
    }
    
    // 设置打点数据
    setAnnotations(annotations) {
        this.annotations = annotations || [];
        
        // 检查有效的标记数据
        const validAnnotations = this.annotations.filter(a => 
            a.marker && a.duration && a.duration > 0
        );
        
        if (validAnnotations.length >= 500) {
            this.useIntervalTree = true;
            this.buildIntervalTree();
        } else {
            this.useIntervalTree = false;
            this.intervalTree = null;
        }
        
        this.updateCurrentMarkers();
    }
    
    // 强制刷新所有当前显示的标记（用于数据更新后的完整刷新）
    refreshAllMarkers() {
        // 清除所有当前标记
        this.clearMarkers();
        // 重新更新标记显示
        this.updateCurrentMarkers();
    }
    
    // 获取当前时间应该显示的标记 - 线性搜索版本
    getCurrentMarkersLinear() {
        const currentMarkers = [];
        
        for (const annotation of this.annotations) {
            // 只处理有marker数据且有时长的打点
            if (!annotation.marker || !annotation.duration || annotation.duration <= 0) {
                continue;
            }
            
            const startTime = annotation.time;
            const endTime = annotation.time + annotation.duration;
            
            // 检查当前播放时间是否在打点的时间范围内
            if (this.currentTime >= startTime && this.currentTime <= endTime) {
                currentMarkers.push(annotation);
            }
        }
        
        return currentMarkers;
    }
    
    // 更新当前播放时间
    updateCurrentTime(time) {
        this.currentTime = time;
        this.updateCurrentMarkers();
    }
    
    // 区间树优化 - 适合大量重叠区间的场景（500+标记）
    buildIntervalTree() {
        // 简化版区间树实现
        this.intervalTree = {
            startPoints: [],
            endPoints: [],
            annotations: new Map()
        };
        
        const validAnnotations = this.annotations.filter(a => 
            a.marker && a.duration && a.duration > 0
        );
        
        for (const annotation of validAnnotations) {
            const startTime = annotation.time;
            const endTime = annotation.time + annotation.duration;
            
            this.intervalTree.startPoints.push({
                time: startTime,
                annotation: annotation,
                type: 'start'
            });
            
            this.intervalTree.endPoints.push({
                time: endTime,
                annotation: annotation,
                type: 'end'
            });
        }
        
        // 按时间排序
        this.intervalTree.startPoints.sort((a, b) => a.time - b.time);
        this.intervalTree.endPoints.sort((a, b) => a.time - b.time);
    }
    
    getCurrentMarkersWithIntervalTree() {
        if (!this.intervalTree) {
            this.buildIntervalTree();
        }
        
        const currentTime = this.currentTime;
        const activeAnnotations = new Set();
        
        // 找到所有在当前时间之前开始的区间
        for (const point of this.intervalTree.startPoints) {
            if (point.time <= currentTime) {
                activeAnnotations.add(point.annotation);
            } else {
                break;
            }
        }
        
        // 移除所有在当前时间之前结束的区间
        for (const point of this.intervalTree.endPoints) {
            if (point.time < currentTime) {
                activeAnnotations.delete(point.annotation);
            } else {
                break;
            }
        }
        
        return Array.from(activeAnnotations);
    }
    
    
    // 更新当前显示的标记
    updateCurrentMarkers() {
        const shouldDisplayMarkers = this.useIntervalTree ? 
            this.getCurrentMarkersWithIntervalTree() : 
            this.getCurrentMarkersLinear();
        
        // 获取应该显示的标记ID集合
        const shouldDisplayIds = new Set(shouldDisplayMarkers.map(a => a.id));
        const annotationMap = new Map(shouldDisplayMarkers.map(a => [a.id, a]));
        
        // 获取当前所有标记ID（包括应该显示的和当前显示的）
        const allMarkerIds = new Set([...shouldDisplayIds, ...this.currentMarkers.keys()]);
        
        // 统一处理所有标记：创建、更新或删除
        for (const id of allMarkerIds) {
            const annotation = annotationMap.get(id);
            this.updatePlayerMarker(id, annotation);
        }
    }
    
    // 创建播放器标记元素
    createPlayerMarker(annotation) {
        const marker = annotation.marker;
        const markerElement = document.createElement('div');
        markerElement.className = `player-marker color-${annotation.color || 'red'}`;
        markerElement.dataset.annotationId = annotation.id;
        
        // 设置标记位置和尺寸
        markerElement.style.cssText = `
            left: ${marker.x}%;
            top: ${marker.y}%;
            width: ${marker.width}%;
            height: ${marker.height}%;
        `;
        
        // 创建内容区域
        const contentArea = document.createElement('div');
        contentArea.className = 'player-marker-content';
        
        // 应用内容位置样式
        this.applyContentPosition(contentArea, marker.contentPosition);
        
        // 创建行内内容
        if (annotation.title || annotation.text) {
            const inlineContent = document.createElement('div');
            inlineContent.className = 'player-marker-inline-content';
            inlineContent.style.cssText = `
                font-size: 1em;
                line-height: 1.3;
                word-wrap: break-word;
                overflow-wrap: break-word;
            `;
            
            let contentHTML = '';
            
            // 添加标题
            if (annotation.title) {
                contentHTML += `<span class="player-marker-title">${this.escapeHtml(annotation.title)}</span>`;
            }
            
            // 如果既有标题又有描述，添加换行
            if (annotation.title && annotation.text) {
                contentHTML += '<br>';
            }
            
            // 添加描述
            if (annotation.text) {
                contentHTML += `<span class="player-marker-description">${this.escapeHtml(annotation.text)}</span>`;
            }
            
            inlineContent.innerHTML = contentHTML;
            contentArea.appendChild(inlineContent);
        }
        
        // 如果既没有标题也没有描述，显示默认文本
        if (!annotation.title && !annotation.text) {
            const defaultText = document.createElement('div');
            defaultText.className = 'player-marker-default-text';
            defaultText.textContent = '标记';
            contentArea.appendChild(defaultText);
        }
        
        markerElement.appendChild(contentArea);
        
        // 创建悬停编辑按钮
        const editButton = document.createElement('div');
        editButton.className = 'player-marker-edit-btn';
        editButton.title = '编辑标记';
        editButton.dataset.annotationId = annotation.id;
        editButton.innerHTML = `
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2,1"/>
                <circle cx="2" cy="2" r="1.5" fill="currentColor"/>
                <circle cx="14" cy="2" r="1.5" fill="currentColor"/>
                <circle cx="2" cy="14" r="1.5" fill="currentColor"/>
                <circle cx="14" cy="14" r="1.5" fill="currentColor"/>
            </svg>
        `;
        
        markerElement.appendChild(editButton);
        
        
        // 复用annotation-popup的编辑按钮事件逻辑
        editButton.addEventListener('click', (e) => {
            e.stopPropagation();
            // 如果打点没有marker数据，先初始化
            if (!annotation.marker) {
                annotation.marker = {
                    x: 25,      // 默认位置25%
                    y: 25,      // 默认位置25%
                    width: 20,  // 默认宽度20%
                    height: 15, // 默认高度15%
                    contentPosition: {
                        horizontalPosition: 'inside',
                        verticalPosition: 'inside',
                        textAlign: 'left',
                        verticalAlign: 'flex-start'
                    }
                };
            }
            // 直接进入标记编辑模式（需要从annotations.js获取方法）
            if (window.annotationManager) {
                window.annotationManager.startMarkerEditingDirect(annotation);
            }
        });
        
        // 阻止按钮的其他鼠标事件
        editButton.addEventListener('mousedown', (e) => e.stopPropagation());
        editButton.addEventListener('mouseup', (e) => e.stopPropagation());
        
        return markerElement;
    }
    
    // 统一的标记管理方法：根据情况创建、更新或删除标记
    updatePlayerMarker(markerId, annotation) {
        const existingElement = this.currentMarkers.get(markerId);
        
        if (!annotation) {
            // 情况1: annotation为null/undefined，需要删除标记
            if (existingElement) {
                this.overlay.removeChild(existingElement);
                this.currentMarkers.delete(markerId);
            }
            return;
        }
        
        if (!existingElement) {
            // 情况2: 标记不存在，需要创建新标记
            const markerElement = this.createPlayerMarker(annotation);
            this.overlay.appendChild(markerElement);
            this.currentMarkers.set(markerId, markerElement);
            return;
        }
        
        // 情况3: 标记已存在，需要更新现有标记
        this.updateExistingMarker(existingElement, annotation);
    }
    
    // 更新已存在的标记元素
    updateExistingMarker(markerElement, annotation) {
        const marker = annotation.marker;
        
        // 更新颜色class
        markerElement.className = `player-marker color-${annotation.color || 'red'}`;
        
        // 更新位置和尺寸
        markerElement.style.cssText = `
            left: ${marker.x}%;
            top: ${marker.y}%;
            width: ${marker.width}%;
            height: ${marker.height}%;
        `;
        
        // 更新内容
        const contentArea = markerElement.querySelector('.player-marker-content');
        if (contentArea) {
            contentArea.innerHTML = ''; // 清空现有内容
            
            // 应用内容位置样式
            this.applyContentPosition(contentArea, marker.contentPosition);
            
            // 重新创建行内内容
            if (annotation.title || annotation.text) {
                const inlineContent = document.createElement('div');
                inlineContent.className = 'player-marker-inline-content';
                inlineContent.style.cssText = `
                    font-size: 1em;
                    line-height: 1.3;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                `;
                
                let contentHTML = '';
                
                // 添加标题
                if (annotation.title) {
                    contentHTML += `<span class="player-marker-title" style="font-weight: bold;">${this.escapeHtml(annotation.title)}</span>`;
                }
                
                // 如果既有标题又有描述，添加换行
                if (annotation.title && annotation.text) {
                    contentHTML += '<br>';
                }
                
                // 添加描述
                if (annotation.text) {
                    contentHTML += `<span class="player-marker-description" style="font-size: 0.85em; opacity: 0.9;">${this.escapeHtml(annotation.text)}</span>`;
                }
                
                inlineContent.innerHTML = contentHTML;
                contentArea.appendChild(inlineContent);
            }
            
            // 如果既没有标题也没有描述，显示默认文本
            if (!annotation.title && !annotation.text) {
                const defaultText = document.createElement('div');
                defaultText.className = 'player-marker-default-text';
                defaultText.textContent = '标记';
                contentArea.appendChild(defaultText);
            }
        }
        
        // 更新编辑按钮的annotation数据
        const editButton = markerElement.querySelector('.player-marker-edit-btn');
        if (editButton) {
            editButton.dataset.annotationId = annotation.id;
            // 重新绑定点击事件以确保使用最新的annotation数据
            const newEditButton = editButton.cloneNode(true);
            editButton.parentNode.replaceChild(newEditButton, editButton);
            
            newEditButton.addEventListener('click', (e) => {
                e.stopPropagation();
                // 如果打点没有marker数据，先初始化
                if (!annotation.marker) {
                    annotation.marker = {
                        x: 25,      // 默认位置25%
                        y: 25,      // 默认位置25%
                        width: 20,  // 默认宽度20%
                        height: 15, // 默认高度15%
                        contentPosition: {
                            horizontalPosition: 'inside',
                            verticalPosition: 'inside',
                            textAlign: 'left',
                            verticalAlign: 'flex-start'
                        }
                    };
                }
                // 直接进入标记编辑模式
                if (window.annotationManager) {
                    window.annotationManager.startMarkerEditingDirect(annotation);
                }
            });
            
            // 阻止按钮的其他鼠标事件
            newEditButton.addEventListener('mousedown', (e) => e.stopPropagation());
            newEditButton.addEventListener('mouseup', (e) => e.stopPropagation());
        }
    }

    // 应用内容位置样式
    applyContentPosition(contentArea, contentPosition) {
        // 检查数据格式，不匹配则使用默认设置（简化兼容逻辑）
        if (!contentPosition || 
            !contentPosition.horizontalPosition ||
            contentPosition.horizontal) {
            // 直接使用默认设置
            contentPosition = {
                horizontalPosition: 'inside',
                verticalPosition: 'inside',
                textAlign: 'left',
                verticalAlign: 'flex-start'
            };
        }

        // 1. 水平位置样式
        let leftStyle = '0';
        let transformXStyle = '0%';
        
        switch (contentPosition.horizontalPosition || 'inside') {
            case 'left-outside':
                leftStyle = '0';
                transformXStyle = '-100%';
                break;
            case 'inside':
                leftStyle = '0';
                transformXStyle = '0%';
                break;
            case 'right-outside':
                leftStyle = '100%';
                transformXStyle = '0%';
                break;
        }

        // 2. 垂直位置样式
        let topStyle = '0';
        let transformYStyle = '0%';
        
        switch (contentPosition.verticalPosition || 'inside') {
            case 'top-outside':
                topStyle = '0';
                transformYStyle = '-100%';
                break;
            case 'inside':
                topStyle = '0';
                transformYStyle = '0%';
                break;
            case 'bottom-outside':
                topStyle = '100%';
                transformYStyle = '0%';
                break;
        }

        // 3. 文本对齐（直接使用设置值）
        const textAlign = contentPosition.textAlign || 'left';

        // 4. 垂直对齐（直接使用设置值）
        const justifyContent = contentPosition.verticalAlign || 'flex-start';

        // 应用样式
        contentArea.style.position = 'absolute';
        contentArea.style.left = leftStyle;
        contentArea.style.top = topStyle;
        contentArea.style.transform = `translate(${transformXStyle}, ${transformYStyle})`;
        contentArea.style.textAlign = textAlign;
        contentArea.style.justifyContent = justifyContent;
        contentArea.style.display = 'flex';
        contentArea.style.flexDirection = 'column';
        contentArea.style.pointerEvents = 'none'; // 防止干扰标记交互
    }
    
    // 转义HTML字符
    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    // 清除所有标记
    clearMarkers() {
        if (this.overlay) {
            this.overlay.innerHTML = '';
        }
        this.currentMarkers.clear();
    }
    
    // 销毁组件
    destroy() {
        this.clearMarkers();
        this.annotations = [];
        this.currentTime = 0;
    }
    
}

// 导出组件
window.MarkerPlayer = MarkerPlayer;
