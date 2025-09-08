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
    }

    // 应用内容位置样式
    applyContentPosition(contentArea, contentPosition) {
        if (!contentPosition) {
            // 使用默认位置：左内，上内
            contentPosition = {
                horizontal: 'left-inside',
                vertical: 'top-inside'
            };
        }

        const horizontal = contentPosition.horizontal || 'left-inside';
        const vertical = contentPosition.vertical || 'top-inside';

        // 水平位置样式
        let leftStyle = '0';
        let transformXStyle = '0%';
        
        switch (horizontal) {
            case 'left-outside':
                leftStyle = '0';
                transformXStyle = '-100%';
                break;
            case 'left-inside':
                leftStyle = '0';
                transformXStyle = '0%';
                break;
            case 'right-inside':
                leftStyle = '100%';
                transformXStyle = '-100%';
                break;
            case 'right-outside':
                leftStyle = '100%';
                transformXStyle = '0%';
                break;
        }

        // 纵向位置样式
        let topStyle = '0';
        let transformYStyle = '0%';
        
        switch (vertical) {
            case 'top-outside':
                topStyle = '0';
                transformYStyle = '-100%';
                break;
            case 'top-inside':
                topStyle = '0';
                transformYStyle = '0%';
                break;
            case 'bottom-inside':
                topStyle = '100%';
                transformYStyle = '-100%';
                break;
            case 'bottom-outside':
                topStyle = '100%';
                transformYStyle = '0%';
                break;
        }

        // 计算text-align和flex-direction
        let textAlign = 'left';
        let flexDirection = 'column';
        
        // 水平方向的text-align
        switch (horizontal) {
            case 'left-inside':   // 左内：左对齐
            case 'right-outside': // 右外：左对齐
                textAlign = 'left';
                break;
            case 'left-outside':  // 左外：右对齐
            case 'right-inside':  // 右内：右对齐
                textAlign = 'right';
                break;
        }
        
        // 垂直方向的flex-direction
        switch (vertical) {
            case 'top-inside':    // 上内：正常顺序
            case 'bottom-outside': // 下外：正常顺序
                flexDirection = 'column';
                break;
            case 'top-outside':   // 上外：反向顺序
            case 'bottom-inside': // 下内：反向顺序
                flexDirection = 'column-reverse';
                break;
        }

        // 应用样式
        contentArea.style.position = 'absolute';
        contentArea.style.left = leftStyle;
        contentArea.style.top = topStyle;
        contentArea.style.transform = `translate(${transformXStyle}, ${transformYStyle})`;
        contentArea.style.textAlign = textAlign;
        contentArea.style.flexDirection = flexDirection;
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
