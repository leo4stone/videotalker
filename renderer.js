// Video.js 播放器初始化和控制
const { ipcRenderer } = require('electron');

// 监听菜单事件
ipcRenderer.on('menu-open-file', () => {
    openFileDialog();
});

let player = null;
let sidePanelOpen = false;
let hasVideoLoaded = false;
let isDragging = false;
let playButtonTimeout = null;
let historyData = null;
let progressZoom = 1; // 进度条缩放倍数（通过宽度实现）
let progressPan = 0;  // 进度条平移位置 (0-100)

// 当 DOM 加载完成时初始化播放器
document.addEventListener('DOMContentLoaded', function() {
    // 初始化 Video.js 播放器
    player = videojs('video-player', {
        controls: false, // 禁用默认控制栏
        responsive: true,
        fluid: false,
        fill: true,
        playbackRates: [0.5, 1, 1.25, 1.5, 2],
        plugins: {},
        // 启用键盘快捷键
        keyboard: {
            volumeStep: 0.1,
            seekStep: 5,
            enableModifiersForNumbers: false
        }
    });

    // 播放器准备就绪
    player.ready(function() {
        console.log('Video.js 播放器已准备就绪');
        
        // 初始化打点管理器
        if (window.annotationManager) {
            window.annotationManager.init(player);
        }
        
        // 添加一些自定义事件监听
        player.on('loadstart', function() {
            updateFileInfo('正在加载视频...');
        });

        player.on('loadedmetadata', function() {
            const duration = player.duration();
            const durationText = formatTime(duration);
            updateFileInfo(`视频时长: ${durationText}`);
            updateSidePanel();
            updateDurationDisplay();
            
            // 更新基于视频时长的最小滑块宽度
            updateMinThumbWidthCSS();
            // 重新计算滑块显示
            updateCustomPanSlider();
            // 初始化时间显示
            updateThumbTimeDisplay();
            // 初始化播放进度指示器
            updatePlaybackIndicator();
            // 初始化播放倍速显示
            initializePlaybackRateDisplay();
        });

        player.on('error', function(error) {
            console.error('播放器错误:', error);
            updateFileInfo('视频加载失败，请检查文件格式');
        });

        player.on('play', function() {
            console.log('开始播放');
            updatePlayPauseButton();
            updateFloatingPlayButton();
        });

        player.on('pause', function() {
            console.log('暂停播放');
            updatePlayPauseButton();
            updateFloatingPlayButton();
        });

        player.on('timeupdate', function() {
            updateSidePanel();
        });

        player.on('volumechange', function() {
            updateSidePanel();
        });

        player.on('ratechange', function() {
            updateSidePanel();
        });

        player.on('ended', function() {
            console.log('播放结束');
            updateFileInfo('播放完成');
            updatePlayPauseButton();
            updateFloatingPlayButton();
        });
    });

    // 绑定按钮事件
    setupEventListeners();
    
    // 设置进度条
    setupProgressBar();
    
    // 初始化UI状态
    initializeUI();
    
    // 初始化历史记录功能
    initializeHistory();
    
    // 初始化进度条缩放功能
    initializeProgressZoom();
    
    // 初始化大纲面板
    initializeOutlinePanel();
});

// 设置事件监听器
function setupEventListeners() {
    // 选择文件按钮
    document.getElementById('open-file').addEventListener('click', function() {
        openFileDialog();
    });
    
    // 记住上次文件的checkbox
    document.getElementById('remember-last-file').addEventListener('change', function() {
        const isChecked = this.checked;
        updateHistoryData({ rememberLastFile: isChecked });
        
        if (!isChecked) {
            // 如果取消勾选，清除上次打开的文件记录
            updateHistoryData({ lastOpenedFile: null });
        }
        
        // 更新文件路径显示
        updateLastFilePathDisplay();
    });



    // 全屏按钮
    document.getElementById('fullscreen').addEventListener('click', function() {
        if (player) {
            if (player.isFullscreen()) {
                player.exitFullscreen();
            } else {
                player.requestFullscreen();
            }
        }
    });

    // 检查格式支持按钮
    document.getElementById('check-support').addEventListener('click', function() {
        checkCodecSupport();
        updateFileInfo('编解码器支持信息已输出到控制台（按 F12 查看）');
    });

    // 展开/收起按钮
    document.getElementById('expand-button').addEventListener('click', function() {
        toggleSidePanel();
    });

    // 浮动播放/暂停按钮
    document.getElementById('floating-play-button').addEventListener('click', function() {
        if (player && hasVideoLoaded) {
            if (player.paused()) {
                player.play();
            } else {
                player.pause();
            }
        }
    });

    // 添加打点按钮
    document.getElementById('add-annotation-btn').addEventListener('click', function(e) {
        e.stopPropagation(); // 阻止事件冒泡
        e.preventDefault(); // 阻止默认行为
        if (player && hasVideoLoaded && window.annotationManager) {
            const currentTime = player.currentTime();
            window.annotationManager.showAddAnnotationModal(currentTime);
        }
    });

    // 添加打点按钮的鼠标按下事件 - 阻止冒泡到进度条拖动
    document.getElementById('add-annotation-btn').addEventListener('mousedown', function(e) {
        e.stopPropagation();
        e.preventDefault();
    });

    // current-time-display容器事件处理 - 阻止冒泡到进度条
    document.getElementById('current-time-display').addEventListener('click', function(e) {
        e.stopPropagation();
    });

    document.getElementById('current-time-display').addEventListener('mousedown', function(e) {
        e.stopPropagation();
    });

    // 鼠标移动时重置浮动按钮隐藏计时器
    document.addEventListener('mousemove', function() {
        if (hasVideoLoaded && !player.paused()) {
            showFloatingPlayButton();
            resetFloatingPlayButtonTimer();
        }
    });

    // 监听键盘事件
    document.addEventListener('keydown', function(e) {
        if (!player) return;

        switch(e.code) {
            case 'Space':
                e.preventDefault();
                if (player.paused()) {
                    player.play();
                } else {
                    player.pause();
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                // 根据修饰键确定跳转时间
                let leftSeekTime = 5; // 默认5秒
                if (e.shiftKey) {
                    leftSeekTime = 30; // Shift + 左箭头 = 30秒
                } else if (e.metaKey || e.ctrlKey) {
                    leftSeekTime = 60; // Cmd/Ctrl + 左箭头 = 60秒
                }
                player.currentTime(Math.max(0, player.currentTime() - leftSeekTime));
                break;
            case 'ArrowRight':
                e.preventDefault();
                // 根据修饰键确定跳转时间
                let rightSeekTime = 5; // 默认5秒
                if (e.shiftKey) {
                    rightSeekTime = 30; // Shift + 右箭头 = 30秒
                } else if (e.metaKey || e.ctrlKey) {
                    rightSeekTime = 60; // Cmd/Ctrl + 右箭头 = 60秒
                }
                player.currentTime(Math.min(player.duration(), player.currentTime() + rightSeekTime));
                break;
            case 'ArrowUp':
                e.preventDefault();
                adjustPlaybackRate(1); // 增加倍速
                break;
            case 'ArrowDown':
                e.preventDefault();
                adjustPlaybackRate(-1); // 减少倍速
                break;
            case 'KeyF':
                e.preventDefault();
                if (player.isFullscreen()) {
                    player.exitFullscreen();
                } else {
                    player.requestFullscreen();
                }
                break;
            case 'KeyM':
                e.preventDefault();
                player.muted(!player.muted());
                break;
            case 'Enter':
                // 检查是否有模态框打开，如果有则不处理
                const hasModal = document.querySelector('.annotation-input-modal') || 
                                document.querySelector('.annotation-modal');
                if (hasModal) {
                    return; // 不阻止默认行为，让模态框内的Enter键正常工作
                }
                
                e.preventDefault();
                // 只有在有视频加载且打点管理器可用时才打开添加打点窗口
                if (hasVideoLoaded && window.annotationManager && player) {
                    const currentTime = player.currentTime();
                    window.annotationManager.showAddAnnotationModal(currentTime);
                }
                break;
        }
    });
}

// 加载视频文件
function loadVideo(filePath) {
    if (!player) {
        console.error('播放器未初始化');
        return;
    }

    try {
        const fileName = filePath.split('/').pop();
        const extension = filePath.split('.').pop().toLowerCase();
        
        // 检查文件格式支持
        if (!isSupportedFormat(extension)) {
            updateFileInfo(`不支持的文件格式: ${extension.toUpperCase()}`);
            showFormatHelp();
            return;
        }

        // 清除之前的源
        player.pause();
        player.currentTime(0);

        // 设置多个视频源以提高兼容性
        const sources = getVideoSources(filePath, extension);
        player.src(sources);

        // 更新文件信息
        updateFileInfo(`正在加载: ${fileName}`);
        
        // 更新侧边面板文件名
        document.getElementById('panel-filename').textContent = fileName;
        
        // 设置打点管理器的当前视频文件
        if (window.annotationManager) {
            window.annotationManager.setCurrentVideoFile(filePath);
        }
        
        // 标记视频已加载，触发UI状态更新
        hasVideoLoaded = true;
        // 视频加载后自动收起侧边栏
        sidePanelOpen = false;
        updateUIVisibility();
        // 显示视频相关的UI元素
        showVideoRelatedElements();
        // 初始化浮动播放按钮
        updateFloatingPlayButton();

        console.log('加载视频:', filePath);
        
        // 更新历史记录
        if (historyData && historyData.rememberLastFile) {
            updateHistoryData({ lastOpenedFile: filePath });
            // 更新文件路径显示
            updateLastFilePathDisplay();
        }
        
        // 监听加载失败事件
        player.one('error', function() {
            console.error('视频加载失败');
            updateFileInfo(`无法播放此文件: ${fileName}`);
            showTroubleshootingTips(extension);
        });

    } catch (error) {
        console.error('加载视频时出错:', error);
        updateFileInfo('视频加载失败');
    }
}

// 检查是否为支持的格式
function isSupportedFormat(extension) {
    const supportedFormats = ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'avi', 'mkv'];
    return supportedFormats.includes(extension);
}

// 获取视频源配置（多格式兼容）
function getVideoSources(filePath, extension) {
    const fileUrl = `file://${filePath}`;
    
    // 为不同格式提供多个 MIME 类型选项
    const sources = [];
    
    switch(extension) {
        case 'mov':
            sources.push(
                { src: fileUrl, type: 'video/quicktime' },
                { src: fileUrl, type: 'video/mp4' }, // MOV 文件有时可以用 mp4 解码器
                { src: fileUrl, type: 'video/x-quicktime' }
            );
            break;
        case 'mp4':
        case 'm4v':
            sources.push(
                { src: fileUrl, type: 'video/mp4' },
                { src: fileUrl, type: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"' }
            );
            break;
        case 'webm':
            sources.push(
                { src: fileUrl, type: 'video/webm' },
                { src: fileUrl, type: 'video/webm; codecs="vp8, vorbis"' },
                { src: fileUrl, type: 'video/webm; codecs="vp9, opus"' }
            );
            break;
        case 'avi':
            sources.push(
                { src: fileUrl, type: 'video/x-msvideo' },
                { src: fileUrl, type: 'video/avi' },
                { src: fileUrl, type: 'video/msvideo' }
            );
            break;
        case 'mkv':
            sources.push(
                { src: fileUrl, type: 'video/x-matroska' },
                { src: fileUrl, type: 'video/mkv' }
            );
            break;
        default:
            sources.push({ src: fileUrl, type: 'video/mp4' });
    }
    
    return sources;
}

// 根据文件扩展名获取视频类型（向后兼容）
function getVideoType(filePath) {
    const extension = filePath.split('.').pop().toLowerCase();
    const typeMap = {
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'ogg': 'video/ogg',
        'mov': 'video/quicktime',
        'avi': 'video/x-msvideo',
        'mkv': 'video/x-matroska',
        'flv': 'video/x-flv',
        'm4v': 'video/mp4'
    };
    return typeMap[extension] || 'video/mp4';
}

// 格式化时间显示
function formatTime(seconds) {
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

// 更新文件信息显示
function updateFileInfo(info) {
    const fileInfoOverlay = document.getElementById('file-info-overlay');
    if (fileInfoOverlay) {
        fileInfoOverlay.textContent = info;
        // 显示信息3秒后自动隐藏
        fileInfoOverlay.classList.add('show');
        setTimeout(() => {
            fileInfoOverlay.classList.remove('show');
        }, 3000);
    }
}

// 显示格式帮助信息
function showFormatHelp() {
    const helpText = '支持的格式: MP4, WebM, OGG, MOV, M4V, AVI, MKV';
    console.log(helpText);
    
    // 可以在界面上显示更详细的帮助
    setTimeout(() => {
        updateFileInfo(helpText);
    }, 2000);
}

// 显示故障排除提示
function showTroubleshootingTips(extension) {
    let tips = '';
    
    switch(extension) {
        case 'mov':
            tips = 'MOV 文件播放问题：1) 检查视频编码是否为 H.264；2) 尝试使用其他播放器转换为 MP4 格式';
            break;
        case 'avi':
            tips = 'AVI 文件播放问题：此格式可能使用不支持的编解码器，建议转换为 MP4 格式';
            break;
        case 'mkv':
            tips = 'MKV 文件播放问题：某些编解码器可能不被支持，建议转换为 MP4 格式';
            break;
        default:
            tips = '播放失败：请检查文件是否损坏，或尝试转换为 MP4 格式';
    }
    
    console.log('故障排除提示:', tips);
    
    setTimeout(() => {
        updateFileInfo(tips);
    }, 3000);
}

// 检查浏览器编解码器支持
function checkCodecSupport() {
    const video = document.createElement('video');
    const codecs = {
        'MP4 (H.264)': 'video/mp4; codecs="avc1.42E01E"',
        'WebM (VP8)': 'video/webm; codecs="vp8"',
        'WebM (VP9)': 'video/webm; codecs="vp9"',
        'OGG (Theora)': 'video/ogg; codecs="theora"',
        'MOV (H.264)': 'video/quicktime; codecs="avc1.42E01E"'
    };
    
    console.log('支持的编解码器:');
    for (const [name, codec] of Object.entries(codecs)) {
        const support = video.canPlayType(codec);
        console.log(`${name}: ${support || '不支持'}`);
    }
}

// 页面卸载时清理资源
window.addEventListener('beforeunload', function() {
    if (player) {
        player.dispose();
    }
});

// 更新播放/暂停按钮文本和图标 (侧边栏中已移除，保留此函数以防其他地方调用)
function updatePlayPauseButton() {
    // 此函数现在为空，因为侧边栏中的播放按钮已被移除
}

// 更新侧边面板信息
function updateSidePanel() {
    if (!player) return;
    
    // 更新时长
    const duration = player.duration();
    if (duration && !isNaN(duration)) {
        document.getElementById('panel-duration').textContent = formatTime(duration);
    }
    
    // 更新当前时间
    const currentTime = player.currentTime();
    if (currentTime !== undefined) {
        document.getElementById('panel-current-time').textContent = formatTime(currentTime);
    }
    
    // 更新音量
    const volume = Math.round(player.volume() * 100);
    document.getElementById('panel-volume').textContent = volume + '%';
    
    // 更新播放速度
    const playbackRate = player.playbackRate();
    document.getElementById('panel-playback-rate').textContent = playbackRate + 'x';
}

// 切换侧边面板显示/隐藏
function toggleSidePanel() {
    const panel = document.getElementById('overlay-ui');
    const expandButton = document.getElementById('expand-button');
    
    sidePanelOpen = !sidePanelOpen;
    
    if (sidePanelOpen) {
        panel.classList.add('show');
        expandButton.classList.add('sidebar-open');
        expandButton.textContent = '›'; // 收起状态显示右箭头
        updateSidePanel(); // 更新面板信息
    } else {
        panel.classList.remove('show');
        expandButton.classList.remove('sidebar-open');
        expandButton.textContent = '‹'; // 展开状态显示左箭头
    }
}

// 初始化UI状态
function initializeUI() {
    // 初始状态：没有视频时显示侧边栏
    if (!hasVideoLoaded) {
        sidePanelOpen = true;
        document.getElementById('overlay-ui').classList.add('show');
        document.getElementById('expand-button').classList.add('sidebar-open');
    }
    
    updateUIVisibility();
    hideVideoRelatedElements(); // 初始时隐藏视频相关元素
    
    // 点击视频区域时切换播放状态
    document.getElementById('video-player').addEventListener('click', function() {
        if (player && hasVideoLoaded) {
            if (player.paused()) {
                player.play();
            } else {
                player.pause();
            }
        }
    });
}

// 更新UI可见性
function updateUIVisibility() {
    const expandButton = document.getElementById('expand-button');
    const overlayUI = document.getElementById('overlay-ui');
    
    if (hasVideoLoaded) {
        // 有视频时，显示展开按钮
        expandButton.classList.remove('hidden');
        if (!sidePanelOpen) {
            overlayUI.classList.remove('show');
            expandButton.classList.remove('sidebar-open');
        }
    } else {
        // 没有视频时，显示侧边栏
        overlayUI.classList.add('show');
        expandButton.classList.add('sidebar-open');
        sidePanelOpen = true;
    }
}

// 显示视频相关的UI元素
function showVideoRelatedElements() {
    const elements = document.querySelectorAll('.hide-when-no-video');
    elements.forEach(element => {
        element.style.display = 'block';
    });
    
    // 显示总时长显示
    const durationDisplay = document.getElementById('video-duration-display');
    if (durationDisplay) {
        durationDisplay.classList.add('show');
    }
}

// 隐藏视频相关的UI元素
function hideVideoRelatedElements() {
    const elements = document.querySelectorAll('.hide-when-no-video');
    elements.forEach(element => {
        element.style.display = 'none';
    });
    
    // 隐藏总时长显示
    const durationDisplay = document.getElementById('video-duration-display');
    if (durationDisplay) {
        durationDisplay.classList.remove('show');
    }
}

// 更新浮动播放按钮
function updateFloatingPlayButton() {
    if (!player || !hasVideoLoaded) return;
    
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const isPaused = player.paused();
    
    if (isPaused) {
        // 暂停状态：显示播放图标，按钮一直显示
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
        showFloatingPlayButton();
        clearTimeout(playButtonTimeout);
    } else {
        // 播放状态：显示暂停图标，2秒后隐藏
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'flex';
        showFloatingPlayButton();
        resetFloatingPlayButtonTimer();
    }
}

// 显示浮动播放按钮
function showFloatingPlayButton() {
    if (!hasVideoLoaded) return;
    
    const floatingButton = document.getElementById('floating-play-button');
    floatingButton.classList.add('show');
}

// 隐藏浮动播放按钮
function hideFloatingPlayButton() {
    const floatingButton = document.getElementById('floating-play-button');
    floatingButton.classList.remove('show');
}

// 重置浮动播放按钮隐藏计时器
function resetFloatingPlayButtonTimer() {
    clearTimeout(playButtonTimeout);
    playButtonTimeout = setTimeout(() => {
        if (player && !player.paused()) {
            hideFloatingPlayButton();
        }
    }, 2000); // 2秒后隐藏
}

// 更新总时长显示
function updateDurationDisplay() {
    if (!player || !hasVideoLoaded) return;
    
    const duration = player.duration();
    const durationDisplay = document.getElementById('video-duration-display');
    const durationText = durationDisplay?.querySelector('.duration-text');
    
    if (durationText && duration && !isNaN(duration)) {
        durationText.textContent = formatTime(duration);
    }
}

// 设置进度条
function setupProgressBar() {
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressTooltip = document.getElementById('progress-tooltip');
    
    // 更新当前时间显示的transform属性（统一处理translateX和scale）
    function updateCurrentTimeTransform(translateXPercent = null, scale = null) {
        const currentTimeDisplay = document.getElementById('current-time-display');
        if (!currentTimeDisplay) return;
        
        const currentTransform = currentTimeDisplay.style.transform;
        
        // 解析当前的translateX和scale值
        const translateXMatch = currentTransform.match(/translateX\(([\d.]+)%\)/);
        const scaleMatch = currentTransform.match(/scale\(([\d.]+)\)/);
        
        // 使用传入的值或保持现有值
        const finalTranslateX = translateXPercent !== null ? translateXPercent : (translateXMatch ? translateXMatch[1] : '100');
        const finalScale = scale !== null ? scale : (scaleMatch ? scaleMatch[1] : '0.8');
        
        // currentTimeDisplay.style.transform = `translateX(${50}%) scale(${1})`;
    }
    
    // 更新当前时间文本和位置
    function updateCurrentTimeDisplay(currentTime, progress) {
        const currentTimeDisplay = document.getElementById('current-time-display');
        const timeText = currentTimeDisplay?.querySelector('.time-text');
        if (timeText) {
            timeText.textContent = formatTime(currentTime);
            
            // 根据进度计算translateX值：0%进度时为100%，100%进度时为0%
            const translateXPercent = 100 - progress;
            updateCurrentTimeTransform(translateXPercent, null); // 只更新translateX，保持scale
        }
    }
    
    // 更新进度条显示的公共逻辑
    function updateProgressDisplay(progress, currentTime) {
        // 更新进度条宽度
        progressBar.style.width = progress + '%';
        
        // 更新当前时间显示
        updateCurrentTimeDisplay(currentTime, progress);
    }
    
    // 更新tooltip显示的公共逻辑
    function updateTooltipDisplay(percent) {
        const tooltipText = document.getElementById('tooltip-text');
        if (tooltipText && player) {
            const time = percent * player.duration();
            tooltipText.textContent = formatTime(time);
            
            
            // 更新主进度条缩略图预览
            updateThumbnailPreview(time, 'main-thumbnail-canvas', 80);
        }
    }
    
    // 更新进度条
    function updateProgress() {
        if (!player || !hasVideoLoaded || isDragging) return;
        
        const currentTime = player.currentTime();
        const duration = player.duration();
        
        if (duration > 0) {
            const progress = (currentTime / duration) * 100;
            updateProgressDisplay(progress, currentTime);
            
            // 更新播放进度指示器
            updatePlaybackIndicator();
        }
    }
    
    // 设置视频时间并更新进度条显示
    function setVideoTime(percent) {
        if (!player || !hasVideoLoaded) return;
        
        const duration = player.duration();
        if (duration > 0) {
            const newTime = percent * duration;
            player.currentTime(newTime);
            // 立即更新进度条显示
            const progress = percent * 100;
            updateProgressDisplay(progress, newTime);
        }
    }
    
    // 鼠标移动时显示时间提示
    progressContainer.addEventListener('mousemove', function(e) {
        if (!player || !hasVideoLoaded) return;
        
        const rect = progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const duration = player.duration();
        
        if (duration > 0) {
            // 更新tooltip内容和位置
            updateTooltipDisplay(percent);
            
            // 设置tooltip容器位置（竖线位置）
            progressTooltip.style.left = e.clientX - rect.left + 'px';
        }
        
        // 拖动时实时更新
        if (isDragging) {
            setVideoTime(percent);
        }
    });
    
    // 鼠标进入时更新scale
    progressContainer.addEventListener('mouseenter', function() {
        if (!player || !hasVideoLoaded) return;
        updateCurrentTimeTransform(null, 1); // 只更新scale，保持translateX
    });
    
    // 鼠标离开时恢复scale
    progressContainer.addEventListener('mouseleave', function() {
        if (!player || !hasVideoLoaded) return;
        updateCurrentTimeTransform(null, 0.8); // 只更新scale，保持translateX
    });
    
    // 鼠标按下开始拖动
    progressContainer.addEventListener('mousedown', function(e) {
        if (!player || !hasVideoLoaded) return;
        
        isDragging = true;
        document.body.style.cursor = 'pointer';
        
        const rect = progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setVideoTime(percent);
    });
    
    // 全局鼠标移动事件（用于拖动时）
    document.addEventListener('mousemove', function(e) {
        if (!isDragging || !player || !hasVideoLoaded) return;
        
        const rect = progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setVideoTime(percent);
        
        // 更新提示位置和内容
        updateTooltipDisplay(percent);
        
        progressTooltip.style.left = (e.clientX - rect.left) + 'px';
    });
    
    // 全局鼠标松开事件
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = 'default';
        }
    });
    
    // 点击进度条跳转（非拖动时）
    progressContainer.addEventListener('click', function(e) {
        if (!player || !hasVideoLoaded) return;
        
        const rect = progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setVideoTime(percent);
    });
    
    // 监听播放器时间更新
    if (player) {
        player.on('timeupdate', function() {
            updateProgress();
            updateOutlinePlayedStatus();
            updateAnnotationContainerPlayedStatus();
        });
    }
}

// 页面加载完成后检查编解码器支持
window.addEventListener('load', function() {
    setTimeout(checkCodecSupport, 1000);
});

// 历史记录相关功能

// 初始化历史记录功能
async function initializeHistory() {
    try {
        // 读取历史记录数据
        historyData = await ipcRenderer.invoke('read-history-file');
        
        // 设置checkbox状态
        const checkbox = document.getElementById('remember-last-file');
        if (checkbox && historyData) {
            checkbox.checked = historyData.rememberLastFile || false;
        }
        
        // 初始化文件路径显示
        updateLastFilePathDisplay();
        
        // 如果启用了记住上次文件且有上次打开的文件，自动打开
        if (historyData && historyData.rememberLastFile && historyData.lastOpenedFile) {
            // 检查文件是否存在
            const fileExists = await ipcRenderer.invoke('check-file-exists', historyData.lastOpenedFile);
            
            if (fileExists) {
                setTimeout(() => {
                    loadVideo(historyData.lastOpenedFile);
                    updateFileInfo('已自动打开上次的视频文件');
                }, 500);
            } else {
                console.log('上次打开的文件不存在，已清除记录');
                // 文件不存在，清除记录
                updateHistoryData({ lastOpenedFile: null });
                // 更新文件路径显示
                updateLastFilePathDisplay();
            }
        }
        
    } catch (error) {
        console.log('初始化历史记录时出错:', error);
        // 创建默认的历史记录数据
        historyData = {
            lastOpenedFile: null,
            rememberLastFile: false,
            recentFiles: []
        };
    }
}

// 更新历史记录数据
async function updateHistoryData(updates) {
    if (!historyData) {
        historyData = {
            lastOpenedFile: null,
            rememberLastFile: false,
            recentFiles: []
        };
    }
    
    // 更新数据
    Object.assign(historyData, updates);
    
    try {
        // 保存到文件
        await ipcRenderer.invoke('write-history-file', historyData);
        console.log('历史记录已更新:', updates);
    } catch (error) {
        console.error('保存历史记录失败:', error);
    }
}

// 文件选择对话框（从事件监听器中提取出来）
function openFileDialog() {
    // 使用 Electron 的 dialog API 选择文件
    ipcRenderer.invoke('open-file-dialog').then(filePath => {
        if (filePath) {
            loadVideo(filePath);
        }
    }).catch(err => {
        console.error('选择文件时出错:', err);
    });
}

// 更新上次文件路径显示
function updateLastFilePathDisplay() {
    const pathContainer = document.getElementById('last-file-path');
    const pathText = document.getElementById('path-text');
    const checkbox = document.getElementById('remember-last-file');
    
    if (!pathContainer || !pathText || !checkbox) return;
    
    const isRememberEnabled = checkbox.checked;
    const lastFilePath = historyData?.lastOpenedFile;
    
    if (isRememberEnabled && lastFilePath) {
        // 显示文件路径，只显示文件名和最后一级目录
        const fileName = lastFilePath.split('/').pop() || lastFilePath.split('\\').pop();
        const pathParts = lastFilePath.split('/').length > 1 ? lastFilePath.split('/') : lastFilePath.split('\\');
        const parentDir = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
        
        const displayPath = parentDir ? `.../${parentDir}/${fileName}` : fileName;
        pathText.textContent = displayPath;
        pathText.title = lastFilePath; // 完整路径作为tooltip
        pathContainer.style.display = 'block';
    } else {
        // 隐藏文件路径显示
        pathContainer.style.display = 'none';
    }
}

// 进度条缩放相关功能

// 初始化进度条缩放功能
function initializeProgressZoom() {
    const customPanSlider = document.getElementById('custom-pan-slider');
    const panThumb = document.getElementById('pan-thumb');
    const progressWrapper = document.getElementById('progress-wrapper');

    // 自定义平移滑块事件
    setupCustomPanSlider(customPanSlider, panThumb);
    
    // 播放进度指示器事件
    setupPlaybackIndicator();
    
    // 设置pan-thumb跟随播放事件
    setupPanThumbFollowEvents();



    // 鼠标悬停显示缩放控制
    progressWrapper?.addEventListener('mouseenter', () => {
        if (hasVideoLoaded) {
            const zoomControl = document.getElementById('progress-zoom-control');
            zoomControl?.classList.add('show');
        }
    });

    progressWrapper?.addEventListener('mouseleave', () => {
        const zoomControl = document.getElementById('progress-zoom-control');
        zoomControl?.classList.remove('show');
    });

    // 初始化自定义滑块显示
    updateCustomPanSlider();
}





// 重置进度条缩放
function resetProgressZoom() {
    progressZoom = 1;
    progressPan = 0;
    updateProgressTransform();
    updatePanControls();
}



// 更新进度条变换（使用宽度而不是scale）
function updateProgressTransform() {
    const progressContainer = document.getElementById('progress-container');
    if (!progressContainer) return;

    // 设置宽度百分比（zoom倍数）
    const widthPercent = progressZoom * 100;
    progressContainer.style.width = `${widthPercent}%`;
    
    // 计算left偏移：progressPan表示在原始视频时间轴上的位置百分比
    // 需要将其转换为progress-container的left偏移百分比
    // 公式：left = -progressPan * zoom（负号表示向左偏移）
    const leftPercent = -progressPan * progressZoom;
    progressContainer.style.left = `${leftPercent}%`;
}

// 更新平移控件状态
function updatePanControls() {
    // 更新自定义滑块
    updateCustomPanSlider();
}

// 设置自定义平移滑块的交互
function setupCustomPanSlider(sliderElement, thumbElement) {
    if (!sliderElement || !thumbElement) return;
    
    let isDragging = false;
    let isResizing = false;
    let resizeType = null; // 'left' 或 'right'
    let startX = 0;
    let startPan = 0;
    let startZoom = 0;
    
    // 滑块主体拖拽事件
    function handleThumbMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();
        
        isDragging = true;
        startX = e.clientX;
        startPan = progressPan;
        
        // 拖拽pan-thumb时取消跟随播放
        disablePanThumbFollow();
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'grabbing';
    }
    
    // 拖拽手柄事件
    function handleResizeMouseDown(e) {
        e.preventDefault();
        e.stopPropagation();
        
        isResizing = true;
        resizeType = e.target.classList.contains('left-handle') ? 'left' : 'right';
        
        // 拖拽resize手柄时也取消跟随播放
        disablePanThumbFollow();
        
        startX = e.clientX;
        startPan = progressPan;
        startZoom = progressZoom;
        
        // 计算并保存初始状态
        const minWidth = getMinThumbWidth();
        const currentThumbWidth = Math.max(minWidth, (1 / startZoom) * 100);
        const maxPosition = 100 - currentThumbWidth;
        const currentPosition = (startPan / 100) * maxPosition;
        
        // 保存左右边界的绝对位置
        window.resizeState = {
            leftBoundary: currentPosition,
            rightBoundary: currentPosition + currentThumbWidth,
            initialThumbWidth: currentThumbWidth
        };
        
        document.addEventListener('mousemove', handleResizeMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'ew-resize';
    }
    
    // 鼠标移动事件
    function handleMouseMove(e) {
        if (!isDragging && !isResizing) return;
        
        const sliderRect = sliderElement.getBoundingClientRect();
        const deltaX = e.clientX - startX;
        
        if (isDragging) {
            // 滑块主体拖拽 - 移动位置（使用百分比计算）
            const sliderWidth = sliderRect.width;
            const deltaPercent = (deltaX / sliderWidth) * 100;
            
            // 计算新的pan位置
            const viewportWidthPercent = 100 / progressZoom;
            const maxPanPercent = 100 - viewportWidthPercent;
            const newPanPercent = startPan + deltaPercent * (maxPanPercent / 100);
            
            // 限制在有效范围内
            progressPan = Math.max(0, Math.min(maxPanPercent, newPanPercent));
            
            updateProgressTransform();
            updateCustomPanSlider();
            updateThumbTimeDisplay();
        }
    }
    
    // 专门的resize鼠标移动事件
    function handleResizeMouseMove(e) {
        if (!isResizing || !window.resizeState) return;
        
        const sliderRect = sliderElement.getBoundingClientRect();
        const deltaX = e.clientX - startX;
        const sliderWidth = sliderRect.width;
        
        // 将像素变化转换为百分比变化
        const deltaPercent = (deltaX / sliderWidth) * 100;
        const minWidth = getMinThumbWidth();
        
        if (resizeType === 'right') {
            // 右侧手柄：固定左边界，调整右边界
            const newThumbWidth = Math.max(minWidth, Math.min(100, window.resizeState.initialThumbWidth + deltaPercent));
            const newZoom = Math.max(1, 100 / newThumbWidth);
            
            // 使用保存的左边界位置计算新的pan值
            const maxNewPosition = 100 - newThumbWidth;
            const newPan = maxNewPosition > 0 ? Math.max(0, Math.min(100, (window.resizeState.leftBoundary / maxNewPosition) * 100)) : 0;
            
            progressZoom = newZoom;
            progressPan = newPan;
            
        } else if (resizeType === 'left') {
            // 左侧手柄：固定右边界，调整左边界
            const newThumbWidth = Math.max(minWidth, Math.min(100, window.resizeState.initialThumbWidth - deltaPercent));
            const newZoom = Math.max(1, 100 / newThumbWidth);
            
            // 根据固定的右边界位置计算新的左边界位置
            const newLeftBoundary = window.resizeState.rightBoundary - newThumbWidth;
            const maxNewPosition = 100 - newThumbWidth;
            const newPan = maxNewPosition > 0 ? Math.max(0, Math.min(100, (newLeftBoundary / maxNewPosition) * 100)) : 0;
            
            progressZoom = newZoom;
            progressPan = newPan;
        }
        
        updateProgressTransform();
        updatePanControls();
    }
    
    // 鼠标松开事件
    function handleMouseUp() {
        if (isDragging) {
            document.removeEventListener('mousemove', handleMouseMove);
        }
        if (isResizing) {
            document.removeEventListener('mousemove', handleResizeMouseMove);
            // 清理resize状态
            delete window.resizeState;
        }
        
        isDragging = false;
        isResizing = false;
        resizeType = null;
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'default';
    }
    
    // 点击滑轨直接跳转
    function handleSliderClick(e) {
        // 如果点击的是滑块本身、手柄、时间显示、播放指示器或播放手柄，不处理
        if (e.target === thumbElement || 
            e.target.classList.contains('resize-handle') ||
            e.target.classList.contains('thumb-time-display') ||
            e.target.classList.contains('playback-indicator') ||
            e.target.classList.contains('playback-handle') ||
            e.target.classList.contains('playback-progress')) return;
        
        const sliderRect = sliderElement.getBoundingClientRect();
        
        // 计算点击位置的百分比
        const clickPercent = ((e.clientX - sliderRect.left) / sliderRect.width) * 100;
        
        // 计算视窗宽度和最大pan范围
        const viewportWidthPercent = 100 / progressZoom;
        const maxPanPercent = 100 - viewportWidthPercent;
        
        // 将点击位置转换为progressPan值
        // 让点击位置成为视窗的中心
        const targetPanPercent = (clickPercent / 100) * maxPanPercent - (viewportWidthPercent / 2);
        
        // 限制在有效范围内
        progressPan = Math.max(0, Math.min(maxPanPercent, targetPanPercent));
        
        updateProgressTransform();
        updateCustomPanSlider();
        updateThumbTimeDisplay();
    }
    
    // 绑定事件
    // 滑块主体拖拽（排除手柄区域）
    thumbElement.addEventListener('mousedown', handleThumbMouseDown);
    
    // 拖拽手柄
    const leftHandle = document.getElementById('left-handle');
    const rightHandle = document.getElementById('right-handle');
    
    if (leftHandle) {
        leftHandle.addEventListener('mousedown', handleResizeMouseDown);
    }
    if (rightHandle) {
        rightHandle.addEventListener('mousedown', handleResizeMouseDown);
    }
    
    // 点击滑轨跳转
    sliderElement.addEventListener('click', handleSliderClick);
}

// 计算滑块对应的时间范围
function calculateThumbTimeRange() {
    if (!player || !hasVideoLoaded) {
        return { startTime: 0, endTime: 0 };
    }
    
    const videoDuration = player.duration();
    const viewportWidthPercent = 100 / progressZoom;
    
    // progressPan直接表示视窗左边缘在原始视频时间轴上的百分比位置
    const startPercent = progressPan / 100;
    const endPercent = (progressPan + viewportWidthPercent) / 100;
    
    // 确保不超出视频边界
    const clampedStartPercent = Math.max(0, Math.min(1, startPercent));
    const clampedEndPercent = Math.max(0, Math.min(1, endPercent));
    
    const startTime = clampedStartPercent * videoDuration;
    const endTime = clampedEndPercent * videoDuration;
    
    return { startTime, endTime };
}

// 更新滑块时间显示
function updateThumbTimeDisplay() {
    const startTimeElement = document.getElementById('thumb-start-time');
    const endTimeElement = document.getElementById('thumb-end-time');
    
    if (!startTimeElement || !endTimeElement) return;
    
    const { startTime, endTime } = calculateThumbTimeRange();
    
    startTimeElement.textContent = formatTime(startTime);
    endTimeElement.textContent = formatTime(endTime);
}

// 计算基于视频时长的最小滑块宽度
function getMinThumbWidth() {
    if (!player || !hasVideoLoaded) {
        return 8; // 如果没有视频，返回默认8%
    }
    
    const videoDurationMinutes = player.duration() / 60; // 视频总分钟数
    const minWidthPercent = 100 / videoDurationMinutes; // 1分钟对应的百分比
    
    // 最小宽度不能小于0.5%（确保可见性），不能大于50%（避免过大）
    return Math.max(0.5, Math.min(50, minWidthPercent));
}

// 更新CSS中的最小宽度变量
function updateMinThumbWidthCSS() {
    const minWidth = getMinThumbWidth();
    const panThumb = document.getElementById('pan-thumb');
    if (panThumb) {
        panThumb.style.setProperty('--min-thumb-width', `${minWidth}%`);
    }
}

// 更新自定义平移滑块的显示
function updateCustomPanSlider() {
    const panThumb = document.getElementById('pan-thumb');
    if (!panThumb) return;
    
    const minWidth = getMinThumbWidth();
    // 计算视窗宽度：在原始视频时间轴上的百分比转换为滑轨上的百分比
    const viewportWidthPercent = 100 / progressZoom;
    const thumbWidthPercent = Math.max(minWidth, viewportWidthPercent);
    
    // 计算视窗位置：progressPan表示视窗左边缘在原始视频时间轴上的百分比位置
    // 需要将其转换为滑轨上的位置百分比
    const maxPanRange = 100 - viewportWidthPercent; // 可pan的范围
    const maxSliderPosition = 100 - thumbWidthPercent; // 滑块可移动的最大位置
    
    // 将progressPan从视频时间轴坐标转换为滑轨坐标
    const thumbPositionPercent = maxPanRange > 0 ? (progressPan / maxPanRange) * maxSliderPosition : 0;
    
    // 设置样式（仅使用百分比，避免像素计算）
    panThumb.style.width = `${thumbWidthPercent}%`;
    panThumb.style.left = `${thumbPositionPercent}%`;
    
    // 更新时间显示
    updateThumbTimeDisplay();
}

// 设置播放进度指示器交互
function setupPlaybackIndicator() {
    setupPlaybackProgress();
    setupPlaybackHandle();
}

// 设置播放进度背景区域的交互（点击跳转）
function setupPlaybackProgress() {
    const playbackProgress = document.getElementById('playback-progress');
    const playbackTooltip = document.getElementById('playback-tooltip');
    const playbackTooltipText = document.getElementById('playback-tooltip-text');
    if (!playbackProgress) return;
    
    // 点击跳转到指定时间
    function handleProgressClick(e) {
        if (!player || !hasVideoLoaded) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        const customPanSlider = document.getElementById('custom-pan-slider');
        const sliderRect = customPanSlider.getBoundingClientRect();
        
        // 计算点击位置对应的视频时间
        const mouseX = e.clientX - sliderRect.left;
        const sliderWidth = sliderRect.width;
        const progressPercent = Math.max(0, Math.min(100, (mouseX / sliderWidth) * 100));
        
        const videoDuration = player.duration();
        const targetTime = (progressPercent / 100) * videoDuration;
        
        // 直接设置播放时间，不影响pan-thumb位置
        player.currentTime(targetTime);
    }
    
    // 鼠标移动时更新时间提示的位置和内容
    function handleProgressMouseMove(e) {
        if (!player || !hasVideoLoaded || !playbackTooltip || !playbackTooltipText) return;
        
        const customPanSlider = document.getElementById('custom-pan-slider');
        const sliderRect = customPanSlider.getBoundingClientRect();
        const progressRect = playbackProgress.getBoundingClientRect();
        
        // 计算鼠标位置对应的视频时间
        const mouseX = e.clientX - sliderRect.left;
        const sliderWidth = sliderRect.width;
        const progressPercent = Math.max(0, Math.min(100, (mouseX / sliderWidth) * 100));
        
        const videoDuration = player.duration();
        const targetTime = (progressPercent / 100) * videoDuration;
        
        // 更新提示文本
        playbackTooltipText.textContent = formatTime(targetTime);
        
        // 设置提示位置（使用百分比，相对于playback-progress的宽度）
        const relativeX = e.clientX - progressRect.left;
        const progressWidth = progressRect.width;
        const positionPercent = Math.max(0, Math.min(100, (relativeX / progressWidth) * 100));
        playbackTooltip.style.left = positionPercent + '%';
        
        // 更新缩略图预览
        updateThumbnailPreview(targetTime, 'playback-thumbnail-canvas', 100);
    }
    
    playbackProgress.addEventListener('click', handleProgressClick);
    playbackProgress.addEventListener('mousemove', handleProgressMouseMove);
}

// 设置播放手柄的拖拽交互
function setupPlaybackHandle() {
    const playbackHandle = document.getElementById('playback-handle');
    if (!playbackHandle) return;
    
    let isDraggingHandle = false;
    
    // 手柄拖拽开始
    function handleHandleMouseDown(e) {
        if (!player || !hasVideoLoaded) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        isDraggingHandle = true;
        document.addEventListener('mousemove', handleHandleMouseMove);
        document.addEventListener('mouseup', handleHandleMouseUp);
        document.body.style.cursor = 'grabbing';
    }
    
    // 手柄拖拽移动
    function handleHandleMouseMove(e) {
        if (!isDraggingHandle || !player || !hasVideoLoaded) return;
        
        const customPanSlider = document.getElementById('custom-pan-slider');
        const sliderRect = customPanSlider.getBoundingClientRect();
        
        // 计算当前鼠标位置对应的视频时间
        const mouseX = e.clientX - sliderRect.left;
        const sliderWidth = sliderRect.width;
        const progressPercent = Math.max(0, Math.min(100, (mouseX / sliderWidth) * 100));
        
        const videoDuration = player.duration();
        const targetTime = (progressPercent / 100) * videoDuration;
        
        // 只设置播放时间，不影响pan-thumb
        player.currentTime(targetTime);
    }
    
    // 手柄拖拽结束
    function handleHandleMouseUp() {
        isDraggingHandle = false;
        document.removeEventListener('mousemove', handleHandleMouseMove);
        document.removeEventListener('mouseup', handleHandleMouseUp);
        document.body.style.cursor = 'default';
    }
    
    playbackHandle.addEventListener('mousedown', handleHandleMouseDown);
}

// 更新播放进度指示器位置
function updatePlaybackIndicator() {
    const playbackIndicator = document.getElementById('playback-indicator');
    const playbackHandle = document.getElementById('playback-handle');
    const playbackHandleTime = document.getElementById('playback-handle-time');
    if (!playbackIndicator || !playbackHandle || !player || !hasVideoLoaded) return;
    
    const currentTime = player.currentTime();
    const duration = player.duration();
    const progressPercent = (currentTime / duration) * 100;
    
    // 设置指示器宽度
    playbackIndicator.style.width = `${progressPercent}%`;
    
    // 设置播放标记位置
    playbackHandle.style.left = `${progressPercent}%`;
    
    // 更新playback-handle内的时间显示
    if (playbackHandleTime) {
        playbackHandleTime.textContent = formatTime(currentTime);
    }
    
    // 如果开启了跟随播放，调整pan-thumb位置
    const panThumbFollowBtn = document.getElementById('pan-thumb-follow-btn');
    if (panThumbFollowBtn && panThumbFollowBtn.getAttribute('data-following') === 'true') {
        updatePanThumbToFollowPlayback(progressPercent);
    }
}

// 根据播放进度调整pan-thumb位置
function updatePanThumbToFollowPlayback(progressPercent) {
    const duration = player.duration();
    if (!duration) return;
    
    // 获取当前视窗宽度（在原始视频时间轴上的百分比）
    const viewportWidthPercent = 100 / progressZoom;
    
    // 计算目标pan位置：让播放进度保持在视窗中心
    // progressPercent是播放进度在整个视频中的百分比(0-100)
    // 目标：让播放进度显示在视窗的中心位置
    const targetPanPercent = progressPercent - (viewportWidthPercent / 2);
    
    // 限制pan范围：确保视窗不超出视频边界
    // 最大pan值 = 100% - 视窗宽度
    const maxPanPercent = 100 - viewportWidthPercent;
    const clampedPanPercent = Math.max(0, Math.min(maxPanPercent, targetPanPercent));
    
    // 检查是否需要更新（防抖动：避免微小抖动）
    // const panDifference = Math.abs(clampedPanPercent - progressPan);
    // if (panDifference < 0.01) return; // 小于0.1%的变化忽略
    
    // 更新全局变量并同步更新所有组件
    progressPan = clampedPanPercent;
    updateCustomPanSlider();
    updateThumbTimeDisplay();
    updateProgressTransform();
}

// 设置pan-thumb跟随播放的相关事件
function setupPanThumbFollowEvents() {
    const panThumbFollowBtn = document.getElementById('pan-thumb-follow-btn');
    
    if (!panThumbFollowBtn) return;
    
    // button点击事件
    panThumbFollowBtn.addEventListener('click', function() {
        const isCurrentlyFollowing = this.getAttribute('data-following') === 'true';
        const newFollowingState = !isCurrentlyFollowing;
        
        // 更新按钮状态
        this.setAttribute('data-following', newFollowingState.toString());
        
        // 更新按钮文字
        const btnText = this.querySelector('.btn-text');
        if (btnText) {
            btnText.textContent = newFollowingState ? '跟随' : '自由';
        }
        
        console.log('Pan-thumb follow:', newFollowingState);
        const panThumb = document.getElementById('pan-thumb');
        
        if (newFollowingState) {
            // 开启跟随时，添加className并立即调整到当前播放位置
            if (panThumb) {
                panThumb.classList.add('following');
            }
            const currentTime = player.currentTime();
            const duration = player.duration();
            if (duration > 0) {
                const progressPercent = (currentTime / duration) * 100;
                updatePanThumbToFollowPlayback(progressPercent);
            }
        } else {
            // 关闭跟随时，移除className
            if (panThumb) {
                panThumb.classList.remove('following');
            }
        }
    });
}

// 在拖拽pan-thumb时取消跟随状态
function disablePanThumbFollow() {
    const panThumbFollowBtn = document.getElementById('pan-thumb-follow-btn');
    if (panThumbFollowBtn && panThumbFollowBtn.getAttribute('data-following') === 'true') {
        // 更新按钮状态为非跟随
        panThumbFollowBtn.setAttribute('data-following', 'false');
        
        // 更新按钮文字
        const btnText = panThumbFollowBtn.querySelector('.btn-text');
        if (btnText) {
            btnText.textContent = '自由';
        }
        
        // 移除跟随状态的className
        const panThumb = document.getElementById('pan-thumb');
        if (panThumb) {
            panThumb.classList.remove('following');
        }
        
        console.log('Pan-thumb follow disabled due to manual drag');
    }
}

// 缩略图预览相关功能
let thumbnailCache = new Map(); // 缓存已生成的缩略图
let thumbnailTimeouts = new Map(); // 多个防抖定时器

// 统一的缩略图预览更新函数
function updateThumbnailPreview(targetTime, canvasId, debounceTime = 100) {
    if (!player || !hasVideoLoaded) return;
    
    // 为每个canvas单独管理防抖定时器
    if (thumbnailTimeouts.has(canvasId)) {
        clearTimeout(thumbnailTimeouts.get(canvasId));
    }
    
    const timeoutId = setTimeout(() => {
        generateThumbnail(targetTime, canvasId);
        thumbnailTimeouts.delete(canvasId);
    }, debounceTime);
    
    thumbnailTimeouts.set(canvasId, timeoutId);
}

// 统一的缩略图生成函数
function generateThumbnail(targetTime, canvasId) {
    const canvas = document.getElementById(canvasId);
    const video = player.el().querySelector('video');
    
    if (!canvas || !video) return;
    
    // 将时间四舍五入到5秒，减少缓存数量
    const roundedTime = Math.round(targetTime / 5) * 5;
    
    // 检查缓存
    if (thumbnailCache.has(roundedTime)) {
        const cachedImageData = thumbnailCache.get(roundedTime);
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = cachedImageData;
        return;
    }
    
    // 如果没有缓存，生成新的缩略图
    extractVideoFrame(video, canvas, roundedTime);
}

// 从视频提取帧
function extractVideoFrame(video, canvas, targetTime) {
    const ctx = canvas.getContext('2d');
    
    // 创建一个离屏视频元素来提取帧
    const offscreenVideo = document.createElement('video');
    offscreenVideo.src = video.src;
    offscreenVideo.currentTime = targetTime;
    offscreenVideo.muted = true;
    offscreenVideo.preload = 'metadata';
    
    // 监听seeked事件
    const onSeeked = () => {
        try {
            // 清除canvas并绘制视频帧
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(offscreenVideo, 0, 0, canvas.width, canvas.height);
            
            // 将结果缓存起来
            const imageData = canvas.toDataURL('image/jpeg', 0.8);
            thumbnailCache.set(Math.round(targetTime / 5) * 5, imageData);
            
            // 限制缓存大小（最多100个缩略图）
            if (thumbnailCache.size > 100) {
                const firstKey = thumbnailCache.keys().next().value;
                thumbnailCache.delete(firstKey);
            }
            
        } catch (error) {
            console.warn('生成缩略图失败:', error);
            // 如果生成失败，显示默认的占位符
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#666';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('预览不可用', canvas.width / 2, canvas.height / 2);
        } finally {
            // 清理离屏视频元素
            offscreenVideo.removeEventListener('seeked', onSeeked);
            offscreenVideo.removeEventListener('error', onError);
            offscreenVideo.remove();
        }
    };
    
    // 监听错误事件
    const onError = () => {
        console.warn('视频帧提取失败');
        // 显示错误占位符
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ff6b6b';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('加载失败', canvas.width / 2, canvas.height / 2);
        
        // 清理
        offscreenVideo.removeEventListener('seeked', onSeeked);
        offscreenVideo.removeEventListener('error', onError);
        offscreenVideo.remove();
    };
    
    offscreenVideo.addEventListener('seeked', onSeeked, { once: true });
    offscreenVideo.addEventListener('error', onError, { once: true });
    
    // 设置时间会自动触发seeked事件
}

// 播放倍速调整功能
function adjustPlaybackRate(direction) {
    if (!player || !hasVideoLoaded) return;
    
    // 支持的播放倍速列表
    const playbackRates = [0.1, 0.2, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 8.0, 16.0];
    
    // 获取当前播放倍速
    const currentRate = player.playbackRate();
    
    // 找到当前倍速在列表中的索引
    let currentIndex = playbackRates.findIndex(rate => Math.abs(rate - currentRate) < 0.01);
    
    // 如果当前倍速不在列表中，找到最接近的倍速
    if (currentIndex === -1) {
        currentIndex = playbackRates.findIndex(rate => rate >= currentRate);
        if (currentIndex === -1) currentIndex = playbackRates.length - 1;
    }
    
    // 计算新的索引
    let newIndex = currentIndex + direction;
    
    // 限制在有效范围内
    newIndex = Math.max(0, Math.min(playbackRates.length - 1, newIndex));
    
    // 设置新的播放倍速
    const newRate = playbackRates[newIndex];
    player.playbackRate(newRate);
    
    // 更新界面显示
    updatePlaybackRateDisplay(newRate);
    
    console.log(`播放倍速调整为: ${newRate}x`);
}

// 更新播放倍速显示
function updatePlaybackRateDisplay(rate) {
    const rateDisplay = document.getElementById('playback-rate-display');
    const rateText = document.getElementById('rate-text');
    
    if (!rateDisplay || !rateText) return;
    
    // 更新文字内容
    rateText.textContent = `${rate}x`;
    
    // 清除所有状态class
    rateDisplay.className = 'playback-rate-display';
    
    // 添加临时显示效果（调节时的闪现）
    rateDisplay.classList.add('temporary');
    
    // 200ms后移除临时效果
    setTimeout(() => {
        rateDisplay.classList.remove('temporary');
        
        if (Math.abs(rate - 1.0) < 0.01) {
            // 倍速为1.0时，2秒后隐藏
            rateDisplay.classList.add('show');
            setTimeout(() => {
                rateDisplay.classList.remove('show');
            }, 2000);
        } else {
            // 倍速不为1.0时，常驻显示
            rateDisplay.classList.add('persistent');
        }
    }, 200);
}

// 初始化播放倍速显示
function initializePlaybackRateDisplay() {
    const rate = player ? player.playbackRate() : 1.0;
    updatePlaybackRateDisplay(rate);
}

// ===============================
// 大纲面板功能
// ===============================

function initializeOutlinePanel() {
    const toggleBtn = document.getElementById('outline-toggle-btn');
    const closeBtn = document.getElementById('outline-close-btn');
    const expandAllBtn = document.getElementById('outline-expand-all-btn');
    const outlinePanel = document.getElementById('outline-panel');
    const mainContent = document.querySelector('.main-content');

    // 切换按钮点击事件
    toggleBtn.addEventListener('click', function() {
        toggleOutlinePanel();
    });

    // 关闭按钮点击事件
    closeBtn.addEventListener('click', function() {
        closeOutlinePanel();
    });

    // 展开所有按钮点击事件
    if (expandAllBtn) {
        expandAllBtn.addEventListener('click', function() {
            expandAllOutlineItems();
        });
    }

    // 初始化面板状态（默认关闭）
    closeOutlinePanel();
}

// 展开所有折叠项
function expandAllOutlineItems() {
    // 清空状态管理对象
    Object.keys(outlineCollapseState).forEach(annotationId => {
        delete outlineCollapseState[annotationId];
    });
    
    // 调用更新方法刷新显示
    updateOutlineCollapseDisplay();
    
    console.log('已展开所有折叠项');
}

function toggleOutlinePanel() {
    const outlinePanel = document.getElementById('outline-panel');
    const mainContent = document.querySelector('.main-content');
    
    if (outlinePanel.classList.contains('open')) {
        closeOutlinePanel();
    } else {
        openOutlinePanel();
    }
}

function openOutlinePanel() {
    const outlinePanel = document.getElementById('outline-panel');
    const mainContent = document.querySelector('.main-content');
    const toggleBtn = document.getElementById('outline-toggle-btn');
    
    outlinePanel.classList.add('open');
    mainContent.classList.add('outline-open');
    
    // 切换按钮状态
    if (toggleBtn) {
        toggleBtn.classList.add('expanded');
        toggleBtn.title = '关闭大纲';
    }
    
    // 生成大纲列表
    generateOutlineList();
}

function closeOutlinePanel() {
    const outlinePanel = document.getElementById('outline-panel');
    const mainContent = document.querySelector('.main-content');
    const toggleBtn = document.getElementById('outline-toggle-btn');
    
    outlinePanel.classList.remove('open');
    mainContent.classList.remove('outline-open');
    
    // 恢复按钮状态
    if (toggleBtn) {
        toggleBtn.classList.remove('expanded');
        toggleBtn.title = '打点大纲';
    }
}

function generateOutlineList() {
    const outlineList = document.getElementById('outline-list');
    
    if (!window.annotationManager) {
        outlineList.innerHTML = '<div class="outline-empty">打点管理器未加载</div>';
        return;
    }
    
    const annotations = window.annotationManager.getAllAnnotations();
    
    if (annotations.length === 0) {
        outlineList.innerHTML = '<div class="outline-empty">暂无打点信息</div>';
        return;
    }
    
    // 清空现有列表
    outlineList.innerHTML = '';
    
    // 为每个打点创建列表项
    annotations.forEach(annotation => {
        const item = createOutlineItem(annotation);
        outlineList.appendChild(item);
    });
    
    // 应用折叠状态
    updateOutlineCollapseDisplay();
}

function createOutlineItem(annotation) {
    const item = document.createElement('div');
    item.className = 'outline-item';
    
    // 添加data-id属性用于识别
    item.setAttribute('data-id', annotation.id);
    
    // 添加颜色类到outline-item
    if (annotation.color) {
        item.classList.add(`color-${annotation.color}`);
    } else {
        item.classList.add('color-blue'); // 默认颜色
    }
    
    // 添加级别类用于缩进
    const normalizedLevel = window.annotationManager ? window.annotationManager.normalizeLevel(annotation.level) : null;
    if (normalizedLevel === '1') {
        item.classList.add('level-high');
    } else if (normalizedLevel === '2') {
        item.classList.add('level-medium');
    } else if (normalizedLevel === '3') {
        item.classList.add('level-low');
    } else {
        item.classList.add('level-default');
    }
    
    // 如果没有标题和内容，添加空打点样式
    if (!annotation.title && !annotation.text) {
        item.classList.add('empty-annotation');
    }
    
    // 如果有时长，添加时长样式
    if (annotation.duration && annotation.duration > 0) {
        item.classList.add('has-duration');
    }
    
    // 判断打点是否已播放完成
    const currentTime = player ? player.currentTime() : 0;
    updateElementPlayedStatus(item, annotation, currentTime);
    
    // 格式化时间信息
    const timeInfo = annotation.duration && annotation.duration > 0 
        ? `${formatTime(annotation.time)} <div class="duration"> ${formatDuration(annotation.duration)}</div>`
        : formatTime(annotation.time);
    
    // 创建新的结构
    item.innerHTML = `
        
        <!-- 内容区域包装器 - 包含左侧竖线、内容和按钮 -->
        <div class="outline-content-wrapper">
            <!-- 时间显示 - 固定在最左侧，带颜色 -->
            <div class="outline-time">${timeInfo}</div>
            <!-- 左侧竖线 - 会根据级别缩进 -->
            <div class="outline-color-indicator"></div>
            
            <!-- 内容区域 -->
            <div class="outline-content">
                <div class="outline-title">${annotation.title || '空白打点'}</div>
                ${annotation.text ? `<div class="outline-text">${annotation.text}</div>` : ''}
            </div>
            
        </div>
        <!-- 操作按钮区域 -->
        <div class="outline-actions">
            <button class="outline-action-btn delete-btn" data-id="${annotation.id}" title="删除打点">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                </svg>
            </button>
        </div>
    `;
    
    // 时间区域点击跳转到对应时间
    const timeElement = item.querySelector('.outline-time');
    timeElement.addEventListener('click', function(e) {
        e.stopPropagation();
        if (player && window.annotationManager) {
            window.annotationManager.jumpToAnnotation(annotation.id);
        }
    });

    // 标题点击编辑，聚焦标题字段
    const titleElement = item.querySelector('.outline-title');
    titleElement.addEventListener('click', function(e) {
        e.stopPropagation();
        if (window.annotationManager) {
            // 打开编辑模态框
            window.annotationManager.showAnnotationDetailModal(annotation.id);
            // 延迟聚焦到标题字段，确保模态框已经渲染
            setTimeout(() => {
                const titleInput = document.querySelector('#annotation-input-title');
                if (titleInput) {
                    titleInput.focus();
                    titleInput.select(); // 选中所有文本，方便直接替换
                }
            }, 100);
        }
    });

    // 内容文本点击编辑，聚焦内容字段
    const textElement = item.querySelector('.outline-text');
    if (textElement) {
        textElement.addEventListener('click', function(e) {
            e.stopPropagation();
            if (window.annotationManager) {
                // 打开编辑模态框
                window.annotationManager.showAnnotationDetailModal(annotation.id);
                // 延迟聚焦到内容字段，确保模态框已经渲染
                setTimeout(() => {
                    const textArea = document.querySelector('#annotation-input-text');
                    if (textArea) {
                        textArea.focus();
                        textArea.select(); // 选中所有文本，方便直接替换
                    }
                }, 100);
            }
        });
    }

    // 删除按钮事件
    const deleteBtn = item.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (window.annotationManager && confirm('确定要删除这个打点吗？')) {
            // 先清理折叠状态，再删除打点
            removeCollapseState(annotation.id);
            window.annotationManager.deleteAnnotation(annotation.id);
        }
    });

    // 竖线点击折叠/展开事件
    const colorIndicator = item.querySelector('.outline-color-indicator');
    colorIndicator.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleCollapseState(annotation.id);
        // 注意：折叠状态的视觉更新现在由 toggleCollapseState -> updateOutlineCollapseDisplay 统一处理
    });

    // 检查是否有下级内容
    checkAndUpdateHasChildren(annotation, colorIndicator);
    // 注意：折叠状态的视觉效果由 updateOutlineCollapseDisplay 统一处理
    
    return item;
}

function getLevelClass(level) {
    const normalizedLevel = window.annotationManager ? 
        window.annotationManager.normalizeLevel(level) : level;
    
    if (normalizedLevel === '1') return 'level-high';
    if (normalizedLevel === '2') return 'level-medium';
    if (normalizedLevel === '3') return 'level-low';
    return 'level-default';
}

function formatTime(seconds) {
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

// 格式化时长显示（优化显示格式）
function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0s';
    
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    
    if (minutes > 0) {
        // 分钟数不补零，秒数补零
        return `${minutes}m${secs.toString().padStart(2, '0')}s`;
    } else {
        // 一分钟以内，秒数不补零
        return `${secs}s`;
    }
}

// 更新大纲视图的函数，供AnnotationManager调用
function updateOutlineView() {
    const outlinePanel = document.getElementById('outline-panel');
    
    // 只有在面板打开时才更新
    if (outlinePanel && outlinePanel.classList.contains('open')) {
        generateOutlineList();
    }
}

// 防抖+节流更新播放状态
let outlineUpdateTimeout = null;
let outlineLastUpdateTime = 0;
let annotationUpdateTimeout = null;
let annotationLastUpdateTime = 0;

// 大纲折叠状态管理
const outlineCollapseState = {}; // 存储折叠状态 {annotationId: true/false}

// 更新大纲的折叠/展开显示状态
function updateOutlineCollapseDisplay() {
    const outlineList = document.querySelector('.outline-list');
    if (!outlineList) return;
    
    const allItems = Array.from(outlineList.querySelectorAll('.outline-item'));
    
    // 1. 重置所有item显示状态和视觉状态
    allItems.forEach(item => {
        item.classList.remove('hidden-by-collapse');
        const colorIndicator = item.querySelector('.outline-color-indicator');
        if (colorIndicator) {
            colorIndicator.removeAttribute('data-hidden-count');
            colorIndicator.classList.remove('collapsed'); // 重置折叠视觉状态
        }
    });
    
    // 2. 根据折叠状态隐藏相应的item并计算数量
    const itemsToRemove = []; // 记录需要从状态管理中移除的item
    
    Object.keys(outlineCollapseState).forEach(collapsedAnnotationId => {
        if (!outlineCollapseState[collapsedAnnotationId]) return; // 只处理折叠状态为true的
        
        const collapsedItem = allItems.find(item => 
            item.getAttribute('data-id') === collapsedAnnotationId
        );
        
        // 如果找不到对应的item，标记为需要移除
        if (!collapsedItem) {
            itemsToRemove.push(collapsedAnnotationId);
            return;
        }
        
        // 获取折叠item的级别
        const collapsedLevel = getItemLevel(collapsedItem);
        const collapsedIndex = allItems.indexOf(collapsedItem);
        let hiddenCount = 0;
        
        // 3. 隐藏后续所有级别低于(数值大于)当前级别的item并计数
        for (let i = collapsedIndex + 1; i < allItems.length; i++) {
            const currentItem = allItems[i];
            const currentLevel = getItemLevel(currentItem);
            
            // 如果遇到级别不低于原item的，停止隐藏
            if (currentLevel <= collapsedLevel) {
                break;
            }
            
            // 隐藏级别低于原item的item
            currentItem.classList.add('hidden-by-collapse');
            hiddenCount++;
        }
        
        // 4. 如果没有可隐藏的后续元素，标记为需要移除
        if (hiddenCount === 0) {
            itemsToRemove.push(collapsedAnnotationId);
            return;
        }
        
        // 5. 设置隐藏数量和折叠视觉状态到竖线
        const colorIndicator = collapsedItem.querySelector('.outline-color-indicator');
        if (colorIndicator) {
            colorIndicator.setAttribute('data-hidden-count', hiddenCount);
            colorIndicator.classList.add('collapsed'); // 添加折叠视觉状态
        }
    });
    
    // 3. 清理无效的折叠状态
    itemsToRemove.forEach(annotationId => {
        delete outlineCollapseState[annotationId];
        console.log(`清理无效的折叠状态: ${annotationId}`);
    });

    // 4. 根据是否有折叠状态来显示/隐藏展开所有按钮
    updateExpandAllButtonVisibility();
}

// 获取outline-item的级别数值
function getItemLevel(item) {
    if (item.classList.contains('level-high')) return 1;
    if (item.classList.contains('level-medium')) return 2;
    if (item.classList.contains('level-low')) return 3;
    if (item.classList.contains('level-default')) return 4;
    return 4; // 默认级别
}

// 切换折叠状态
function toggleCollapseState(annotationId) {
    outlineCollapseState[annotationId] = !outlineCollapseState[annotationId];
    updateOutlineCollapseDisplay();
}

// 清理删除打点的折叠状态
function removeCollapseState(annotationId) {
    if (outlineCollapseState.hasOwnProperty(annotationId)) {
        delete outlineCollapseState[annotationId];
        updateOutlineCollapseDisplay();
    }
}

// 更新展开所有按钮的显示/隐藏状态
function updateExpandAllButtonVisibility() {
    const expandAllBtn = document.getElementById('outline-expand-all-btn');
    if (!expandAllBtn) return;
    
    // 检查是否有任何有效的折叠状态
    const hasCollapsedItems = Object.keys(outlineCollapseState).some(
        annotationId => outlineCollapseState[annotationId] === true
    );
    
    if (hasCollapsedItems) {
        expandAllBtn.style.display = 'flex'; // 显示按钮
    } else {
        expandAllBtn.style.display = 'none'; // 隐藏按钮
    }
}

// 检查是否有下级内容并更新指示器
function checkAndUpdateHasChildren(annotation, colorIndicator) {
    if (!window.annotationManager) return;
    
    const annotations = window.annotationManager.getAllAnnotations();
    const currentLevel = getItemLevel({classList: {
        contains: (className) => {
            const normalizedLevel = window.annotationManager.normalizeLevel(annotation.level);
            if (normalizedLevel === '1') return className === 'level-high';
            if (normalizedLevel === '2') return className === 'level-medium';
            if (normalizedLevel === '3') return className === 'level-low';
            return className === 'level-default';
        }
    }});
    
    // 找到当前打点在数组中的位置
    const currentIndex = annotations.findIndex(ann => ann.id === annotation.id);
    
    // 检查后续是否有级别低于当前级别的打点
    let hasChildren = false;
    for (let i = currentIndex + 1; i < annotations.length; i++) {
        const nextAnnotation = annotations[i];
        const nextLevel = getItemLevel({classList: {
            contains: (className) => {
                const normalizedLevel = window.annotationManager.normalizeLevel(nextAnnotation.level);
                if (normalizedLevel === '1') return className === 'level-high';
                if (normalizedLevel === '2') return className === 'level-medium';
                if (normalizedLevel === '3') return className === 'level-low';
                return className === 'level-default';
            }
        }});
        
        // 如果遇到级别不低于当前级别的，停止检查
        if (nextLevel <= currentLevel) {
            break;
        }
        
        // 如果有级别低于当前级别的，说明有下级内容
        if (nextLevel > currentLevel) {
            hasChildren = true;
            break;
        }
    }
    
    // 根据是否有下级内容添加或移除 has-children 类
    if (hasChildren) {
        colorIndicator.classList.add('has-children');
    } else {
        colorIndicator.classList.remove('has-children');
        // 如果没有下级内容，同时清理可能存在的折叠状态
        if (outlineCollapseState[annotation.id]) {
            delete outlineCollapseState[annotation.id];
            console.log(`清理无下级内容的折叠状态: ${annotation.id}`);
        }
    }
}

// ===============================
// 通用打点播放状态管理
// ===============================

// 判断打点是否已播放完成
function isAnnotationPlayed(annotation, currentTime) {
    const annotationEndTime = annotation.time + (annotation.duration || 0);
    return currentTime > annotationEndTime;
}

// 更新元素的播放状态样式
function updateElementPlayedStatus(element, annotation, currentTime) {
    if (isAnnotationPlayed(annotation, currentTime)) {
        element.classList.add('played');
    } else {
        element.classList.remove('played');
    }
}

// 更新大纲中已播放打点的样式（防抖+节流）
function updateOutlinePlayedStatus() {
    const now = Date.now();
    const timeSinceLastUpdate = now - outlineLastUpdateTime;
    
    // 如果距离上次更新超过1秒，立即执行
    if (timeSinceLastUpdate >= 1000) {
        updateOutlinePlayedStatusImmediate();
        outlineLastUpdateTime = now;
        return;
    }
    
    // 清除之前的防抖定时器
    if (outlineUpdateTimeout) {
        clearTimeout(outlineUpdateTimeout);
    }
    
    // 设置防抖延迟
    outlineUpdateTimeout = setTimeout(() => {
        updateOutlinePlayedStatusImmediate();
        outlineLastUpdateTime = Date.now();
    }, 100); // 100ms防抖
}

function updateOutlinePlayedStatusImmediate() {
    const outlinePanel = document.getElementById('outline-panel');
    
    // 只有在面板打开时才更新
    if (!outlinePanel || !outlinePanel.classList.contains('open') || !player) {
        return;
    }
    
    const currentTime = player.currentTime();
    const outlineItems = document.querySelectorAll('.outline-item');
    
    // 获取所有打点数据
    const annotations = window.annotationManager ? window.annotationManager.getAllAnnotations() : [];
    
    outlineItems.forEach((item, index) => {
        if (index < annotations.length) {
            const annotation = annotations[index];
            updateElementPlayedStatus(item, annotation, currentTime);
        }
    });
}

// 更新进度条上annotation-container的播放状态（防抖+节流）
function updateAnnotationContainerPlayedStatus() {
    const now = Date.now();
    const timeSinceLastUpdate = now - annotationLastUpdateTime;
    
    // 如果距离上次更新超过1秒，立即执行
    if (timeSinceLastUpdate >= 1000) {
        updateAnnotationContainerPlayedStatusImmediate();
        annotationLastUpdateTime = now;
        return;
    }
    
    // 清除之前的防抖定时器
    if (annotationUpdateTimeout) {
        clearTimeout(annotationUpdateTimeout);
    }
    
    // 设置防抖延迟
    annotationUpdateTimeout = setTimeout(() => {
        updateAnnotationContainerPlayedStatusImmediate();
        annotationLastUpdateTime = Date.now();
    }, 100); // 100ms防抖
}

function updateAnnotationContainerPlayedStatusImmediate() {
    if (!player) {
        return;
    }
    
    const currentTime = player.currentTime();
    const annotationContainers = document.querySelectorAll('.annotation-container');
    
    // 获取所有打点数据
    const annotations = window.annotationManager ? window.annotationManager.getAllAnnotations() : [];
    
    annotationContainers.forEach((container) => {
        const annotationId = container.dataset.annotationId;
        const annotation = annotations.find(ann => ann.id === annotationId);
        
        if (annotation) {
            updateElementPlayedStatus(container, annotation, currentTime);
        }
    });
}

// 将updateOutlineView函数绑定到window对象，供其他模块调用
window.updateOutlineView = updateOutlineView;
window.updateOutlinePlayedStatus = updateOutlinePlayedStatus;
window.updateElementPlayedStatus = updateElementPlayedStatus;
window.updateAnnotationContainerPlayedStatus = updateAnnotationContainerPlayedStatus;
window.updateOutlineCollapseDisplay = updateOutlineCollapseDisplay;
window.removeCollapseState = removeCollapseState;
window.expandAllOutlineItems = expandAllOutlineItems;

