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
                player.volume(Math.min(1, player.volume() + 0.1));
                break;
            case 'ArrowDown':
                e.preventDefault();
                player.volume(Math.max(0, player.volume() - 0.1));
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
            
            // 根据进度计算数字提示的translateX值：0%进度时为0%，100%进度时为-100%
            const translateXPercent = -(percent * 100);
            tooltipText.style.transform = `translateX(${-50}%)`;
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
        player.on('timeupdate', updateProgress);
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
    const panThumbFollowCheckbox = document.getElementById('pan-thumb-follow');
    if (panThumbFollowCheckbox && panThumbFollowCheckbox.checked) {
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
    const panThumbFollowCheckbox = document.getElementById('pan-thumb-follow');
    
    if (!panThumbFollowCheckbox) return;
    
    // checkbox点击事件
    panThumbFollowCheckbox.addEventListener('change', function() {
        console.log('Pan-thumb follow:', this.checked);
        if (this.checked) {
            // 开启跟随时，立即调整到当前播放位置
            const currentTime = player.currentTime();
            const duration = player.duration();
            if (duration > 0) {
                const progressPercent = (currentTime / duration) * 100;
                updatePanThumbToFollowPlayback(progressPercent);
            }
        }
    });
    
    // label点击事件（确保点击文字也能切换checkbox）
    const panThumbFollowLabel = document.querySelector('.pan-thumb-checkbox-label');
    if (panThumbFollowLabel) {
        panThumbFollowLabel.addEventListener('click', function() {
            panThumbFollowCheckbox.checked = !panThumbFollowCheckbox.checked;
            panThumbFollowCheckbox.dispatchEvent(new Event('change'));
        });
    }
}

// 在拖拽pan-thumb时取消跟随状态
function disablePanThumbFollow() {
    const panThumbFollowCheckbox = document.getElementById('pan-thumb-follow');
    if (panThumbFollowCheckbox && panThumbFollowCheckbox.checked) {
        panThumbFollowCheckbox.checked = false;
        console.log('Pan-thumb follow disabled due to manual drag');
    }
}
