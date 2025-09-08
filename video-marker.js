/**
 * 视频标记组件 - VideoMarker
 * 用于在视频上方添加可拖拽和调整大小的矩形标记
 */
class VideoMarker {
    constructor(container) {
        this.container = container;
        this.markers = new Map(); // 存储所有标记
        this.nextMarkerId = 1;
        this.isDragging = false;
        this.isResizing = false;
        this.currentMarker = null;
        this.dragData = null;
        this.resizeData = null;
        
        this.init();
    }
    
    init() {
        this.createOverlay();
        this.bindEvents();
        this.updateOverlaySize();
    }
    
    // 创建透明覆盖层
    createOverlay() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'video-marker-overlay';
        
        this.container.appendChild(this.overlay);
    }
    
    // 绑定事件
    bindEvents() {
        // 全局鼠标事件
        document.addEventListener('mousemove', (e) => {
            this.handleMouseMove(e);
        });
        
        document.addEventListener('mouseup', (e) => {
            this.handleMouseUp(e);
        });
        
        // 键盘事件
        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });
        
        // 窗口大小变化时更新覆盖层
        window.addEventListener('resize', () => {
            // 延迟更新，等待布局完成
            setTimeout(() => {
                this.updateOverlaySize();
                this.updateFontSize();
            }, 100);
        });
    }
    
    // 更新覆盖层尺寸以匹配视频画面
    updateOverlaySize() {
        const video = this.container.querySelector('video');
        if (!video || !this.overlay) return;
        
        // 等待视频元数据加载完成
        if (video.readyState >= 1) {
            this.adjustOverlayToVideo(video);
        } else {
            video.addEventListener('loadedmetadata', () => {
                this.adjustOverlayToVideo(video);
            }, { once: true });
        }
    }
    
    // 调整覆盖层以匹配视频实际尺寸
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
                // 容器比视频更宽，视频会有左右黑边，应该限制高度
                this.overlay.style.width = 'auto';
                this.overlay.style.height = '100%';
            } else {
                // 容器比视频更高，视频会有上下黑边，应该限制宽度
                this.overlay.style.width = '100%';
                this.overlay.style.height = 'auto';
            }
            
            // 更新字体大小（延迟一点确保布局完成）
            setTimeout(() => {
                this.updateFontSize();
            }, 10);
            
            console.log(`视频宽高比: ${videoAspectRatio.toFixed(3)} (${videoWidth}x${videoHeight})`);
            console.log(`容器宽高比: ${containerAspectRatio.toFixed(3)} (${containerRect.width.toFixed(1)}x${containerRect.height.toFixed(1)})`);
            console.log(`覆盖层尺寸策略: ${containerAspectRatio > videoAspectRatio ? '限制高度' : '限制宽度'}`);
        }
    }
    
    // 更新字体大小，基于视频画面的实际高度
    updateFontSize() {
        if (!this.overlay) {
            console.warn('updateFontSize: overlay不存在');
            return;
        }
        
        // 检查overlay是否可见
        const computedStyle = getComputedStyle(this.overlay);
        if (computedStyle.display === 'none') {
            console.warn('updateFontSize: overlay未显示，跳过字体大小计算');
            return;
        }
        
        // 获取覆盖层的实际渲染尺寸
        const overlayRect = this.overlay.getBoundingClientRect();
        const actualVideoHeight = overlayRect.height;
        
        console.log(`updateFontSize: overlay尺寸 ${overlayRect.width.toFixed(1)}x${overlayRect.height.toFixed(1)}`);
        
        if (actualVideoHeight <= 0) {
            console.warn('updateFontSize: 视频高度为0，等待下次更新');
            return;
        }
        
        // 计算字体大小：视频高度的1.2%
        const fontSize = actualVideoHeight * 0.024;
        
        // 设置覆盖层的字体大小
        this.overlay.style.fontSize = `${fontSize}px`;
        
        console.log(`updateFontSize: 视频实际高度 ${actualVideoHeight.toFixed(1)}px, 字体大小 ${fontSize.toFixed(1)}px`);
    }
    
    
    // 处理鼠标移动
    handleMouseMove(e) {
        if (this.isDragging && this.dragData) {
            this.updateMarkerPosition(e);
        } else if (this.isResizing && this.resizeData) {
            this.updateMarkerSize(e);
        }
    }
    
    // 更新标记位置
    updateMarkerPosition(e) {
        const deltaX = e.clientX - this.dragData.startX;
        const deltaY = e.clientY - this.dragData.startY;
        
        const deltaXPercent = (deltaX / this.dragData.overlayWidth) * 100;
        const deltaYPercent = (deltaY / this.dragData.overlayHeight) * 100;
        
        const newX = this.dragData.startMarkerX + deltaXPercent;
        const newY = this.dragData.startMarkerY + deltaYPercent;
        
        // 边界检查
        this.currentMarker.x = Math.max(0, Math.min(100 - this.currentMarker.width, newX));
        this.currentMarker.y = Math.max(0, Math.min(100 - this.currentMarker.height, newY));
        
        this.updateMarkerElement(this.currentMarker);
    }
    
    // 更新标记大小
    updateMarkerSize(e) {
        const deltaX = e.clientX - this.resizeData.startX;
        const deltaY = e.clientY - this.resizeData.startY;
        
        const deltaXPercent = (deltaX / this.resizeData.overlayWidth) * 100;
        const deltaYPercent = (deltaY / this.resizeData.overlayHeight) * 100;
        
        const direction = this.resizeData.direction.replace('resize-', '');
        let newX = this.resizeData.startMarkerX;
        let newY = this.resizeData.startMarkerY;
        let newWidth = this.resizeData.startMarkerWidth;
        let newHeight = this.resizeData.startMarkerHeight;
        
        // 根据拖拽方向调整位置和大小
        switch (direction) {
            case 'nw': // 左上角
                newX = this.resizeData.startMarkerX + deltaXPercent;
                newY = this.resizeData.startMarkerY + deltaYPercent;
                newWidth = this.resizeData.startMarkerWidth - deltaXPercent;
                newHeight = this.resizeData.startMarkerHeight - deltaYPercent;
                break;
            case 'ne': // 右上角
                newY = this.resizeData.startMarkerY + deltaYPercent;
                newWidth = this.resizeData.startMarkerWidth + deltaXPercent;
                newHeight = this.resizeData.startMarkerHeight - deltaYPercent;
                break;
            case 'sw': // 左下角
                newX = this.resizeData.startMarkerX + deltaXPercent;
                newWidth = this.resizeData.startMarkerWidth - deltaXPercent;
                newHeight = this.resizeData.startMarkerHeight + deltaYPercent;
                break;
            case 'se': // 右下角
                newWidth = this.resizeData.startMarkerWidth + deltaXPercent;
                newHeight = this.resizeData.startMarkerHeight + deltaYPercent;
                break;
        }
        
        // 边界检查和最小尺寸限制
        const minSize = 1; // 最小1%
        newWidth = Math.max(minSize, newWidth);
        newHeight = Math.max(minSize, newHeight);
        
        // 确保不超出边界
        newX = Math.max(0, Math.min(100 - newWidth, newX));
        newY = Math.max(0, Math.min(100 - newHeight, newY));
        
        this.currentMarker.x = newX;
        this.currentMarker.y = newY;
        this.currentMarker.width = newWidth;
        this.currentMarker.height = newHeight;
        
        this.updateMarkerElement(this.currentMarker);
    }
    
    // 更新标记DOM元素
    updateMarkerElement(marker) {
        const element = this.overlay.querySelector(`[data-marker-id="${marker.id}"]`);
        if (element) {
            element.style.left = `${marker.x}%`;
            element.style.top = `${marker.y}%`;
            element.style.width = `${marker.width}%`;
            element.style.height = `${marker.height}%`;
        }
    }
    
    // 选中标记（公开方法）
    selectMarker(markerId) {
        // 清除之前的选中状态
        this.overlay.querySelectorAll('.video-marker').forEach(el => {
            el.classList.remove('selected');
        });
        
        // 选中当前标记
        const element = this.overlay.querySelector(`[data-marker-id="${markerId}"]`);
        if (element) {
            element.classList.add('selected');
            element.style.zIndex = '1';
        }
        
        const marker = this.markers.get(markerId);
        if (marker) {
            this.currentMarker = marker;
        }
    }
    
    // 开始拖拽（公开方法）
    startDragging(e, marker) {
        this.isDragging = true;
        this.currentMarker = marker;
        this.selectMarker(marker.id);
        
        const rect = this.overlay.getBoundingClientRect();
        this.dragData = {
            startX: e.clientX,
            startY: e.clientY,
            startMarkerX: marker.x,
            startMarkerY: marker.y,
            overlayWidth: rect.width,
            overlayHeight: rect.height
        };
        
        e.preventDefault();
        document.body.style.userSelect = 'none';
    }
    
    // 开始调整大小（公开方法）
    startResizing(e, marker, direction) {
        this.isResizing = true;
        this.currentMarker = marker;
        this.selectMarker(marker.id);
        
        const rect = this.overlay.getBoundingClientRect();
        this.resizeData = {
            startX: e.clientX,
            startY: e.clientY,
            startMarkerX: marker.x,
            startMarkerY: marker.y,
            startMarkerWidth: marker.width,
            startMarkerHeight: marker.height,
            direction: direction.replace('resize-', ''),
            overlayWidth: rect.width,
            overlayHeight: rect.height
        };
        
        e.preventDefault();
        e.stopPropagation();
        document.body.style.userSelect = 'none';
    }
    
    // 添加调整大小控制点（公开方法）
    addResizeHandles(markerElement) {
        const handles = ['nw', 'ne', 'sw', 'se'];
        
        handles.forEach(position => {
            const handle = document.createElement('div');
            handle.className = `resize-handle resize-${position}`;
            handle.style.cssText = `
                position: absolute;
                width: 8px;
                height: 8px;
                background: #fff;
                border: 1px solid #333;
                cursor: ${position}-resize;
                z-index: 1;
            `;
            
            switch (position) {
                case 'nw':
                    handle.style.top = '-4px';
                    handle.style.left = '-4px';
                    break;
                case 'ne':
                    handle.style.top = '-4px';
                    handle.style.right = '-4px';
                    break;
                case 'sw':
                    handle.style.bottom = '-4px';
                    handle.style.left = '-4px';
                    break;
                case 'se':
                    handle.style.bottom = '-4px';
                    handle.style.right = '-4px';
                    break;
            }
            
            markerElement.appendChild(handle);
        });
    }

    // 添加内容位置控制（公开方法）
    addPositionControls(markerElement, marker) {
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'marker-position-controls';

        // 水平位置按钮组
        const horizontalButtons = document.createElement('div');
        horizontalButtons.className = 'horizontal-buttons';

        // 水平位置按钮选项
        const horizontalOptions = [
            { value: 'left-outside', text: '◀' },
            { value: 'left-inside', text: '▶' },
            { value: 'right-inside', text: '◀' },
            { value: 'right-outside', text: '▶' }
        ];

        const currentHorizontal = marker.contentPosition?.horizontal || 'left-inside';
        
        horizontalOptions.forEach(option => {
            const button = document.createElement('button');
            button.className = 'horizontal-position-btn';
            button.dataset.value = option.value;
            button.textContent = option.text;
            button.type = 'button';
            
            // 设置选中状态
            if (option.value === currentHorizontal) {
                button.classList.add('selected');
            }
            
            horizontalButtons.appendChild(button);
        });

        // 纵向位置按钮组
        const verticalButtons = document.createElement('div');
        verticalButtons.className = 'vertical-buttons';

        // 纵向位置按钮选项
        const verticalOptions = [
            { value: 'top-outside', text: '▲' },
            { value: 'top-inside', text: '▼' },
            { value: 'bottom-inside', text: '▲' },
            { value: 'bottom-outside', text: '▼' }
        ];

        const currentVertical = marker.contentPosition?.vertical || 'top-inside';
        
        verticalOptions.forEach(option => {
            const button = document.createElement('button');
            button.className = 'vertical-position-btn';
            button.dataset.value = option.value;
            button.textContent = option.text;
            button.type = 'button';
            
            // 设置选中状态
            if (option.value === currentVertical) {
                button.classList.add('selected');
            }
            
            verticalButtons.appendChild(button);
        });

        // 绑定水平按钮事件
        horizontalButtons.querySelectorAll('.horizontal-position-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // 更新选中状态
                horizontalButtons.querySelectorAll('.horizontal-position-btn').forEach(btn => {
                    btn.classList.remove('selected');
                });
                button.classList.add('selected');
                
                // 更新marker数据
                if (!marker.contentPosition) {
                    marker.contentPosition = {};
                }
                marker.contentPosition.horizontal = button.dataset.value;
                this.updateMarkerContentPosition(markerElement, marker);
            });

            // 防止鼠标事件冒泡
            button.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
        });

        // 绑定纵向按钮事件
        verticalButtons.querySelectorAll('.vertical-position-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // 更新选中状态
                verticalButtons.querySelectorAll('.vertical-position-btn').forEach(btn => {
                    btn.classList.remove('selected');
                });
                button.classList.add('selected');
                
                // 更新marker数据
                if (!marker.contentPosition) {
                    marker.contentPosition = {};
                }
                marker.contentPosition.vertical = button.dataset.value;
                this.updateMarkerContentPosition(markerElement, marker);
            });

            // 防止鼠标事件冒泡
            button.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
        });

        // 组装控件
        controlsContainer.appendChild(horizontalButtons);
        controlsContainer.appendChild(verticalButtons);
        
        // 防止控件容器的事件冒泡
        controlsContainer.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        controlsContainer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        markerElement.appendChild(controlsContainer);

        // 初始化内容位置
        this.updateMarkerContentPosition(markerElement, marker);
    }

    // 更新标记内容位置
    updateMarkerContentPosition(markerElement, marker) {
        const contentArea = markerElement.querySelector('.marker-content');
        if (!contentArea) return;

        const horizontal = marker.contentPosition?.horizontal || 'left-inside';
        const vertical = marker.contentPosition?.vertical || 'top-inside';

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
        contentArea.style.left = leftStyle;
        contentArea.style.top = topStyle;
        contentArea.style.transform = `translate(${transformXStyle}, ${transformYStyle})`;
        contentArea.style.textAlign = textAlign;
        contentArea.style.flexDirection = flexDirection;
    }
    
    // 处理鼠标释放
    handleMouseUp(e) {
        if (this.isDragging || this.isResizing) {
            this.isDragging = false;
            this.isResizing = false;
            this.dragData = null;
            this.resizeData = null;
            document.body.style.userSelect = '';
            
            console.log('标记操作完成:', this.currentMarker);
        }
    }
    
    
    // 显示右键菜单
    showContextMenu(e, marker) {
        const menu = document.createElement('div');
        menu.className = 'marker-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${e.clientX}px;
            top: ${e.clientY}px;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 1000;
            min-width: 120px;
        `;
        
        const deleteOption = document.createElement('div');
        deleteOption.textContent = '删除标记';
        deleteOption.style.cssText = `
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
        `;
        deleteOption.addEventListener('click', () => {
            this.deleteMarker(marker.id);
            document.body.removeChild(menu);
        });
        deleteOption.addEventListener('mouseenter', () => {
            deleteOption.style.background = '#f0f0f0';
        });
        deleteOption.addEventListener('mouseleave', () => {
            deleteOption.style.background = '';
        });
        
        menu.appendChild(deleteOption);
        document.body.appendChild(menu);
        
        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                document.body.removeChild(menu);
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }
    
    // 删除标记
    deleteMarker(markerId) {
        const element = this.overlay.querySelector(`[data-marker-id="${markerId}"]`);
        if (element) {
            this.overlay.removeChild(element);
        }
        this.markers.delete(markerId);
        
        if (this.currentMarker && this.currentMarker.id === markerId) {
            this.currentMarker = null;
        }
        
        console.log('删除标记:', markerId);
    }
    
    // 处理键盘事件
    handleKeyDown(e) {
        if (this.currentMarker && e.key === 'Delete') {
            this.deleteMarker(this.currentMarker.id);
        }
    }
    
    // 获取所有标记数据
    getMarkers() {
        return Array.from(this.markers.values());
    }
    
    // 清除所有标记
    clearMarkers() {
        this.overlay.innerHTML = '';
        this.markers.clear();
        this.currentMarker = null;
        console.log('已清除所有标记');
    }
    
    // 销毁组件
    destroy() {
        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
        }
        this.markers.clear();
        this.currentMarker = null;
        console.log('VideoMarker组件已销毁');
    }
}

// 导出组件
window.VideoMarker = VideoMarker;
