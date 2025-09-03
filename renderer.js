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
                player.currentTime(Math.max(0, player.currentTime() - 10));
                break;
            case 'ArrowRight':
                e.preventDefault();
                player.currentTime(Math.min(player.duration(), player.currentTime() + 10));
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
