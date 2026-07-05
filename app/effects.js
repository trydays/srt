/* === effects.js — 三天remotion 效果映射 === */

var EFFECT_MAP = [
  {keys:['淡入','fade in','渐显'],            cmd:'ffmpeg -i INPUT -vf "fade=in:0:30" OUTPUT',       desc:'淡入效果 — 画面从黑渐显'},
  {keys:['淡出','fade out','渐隐'],            cmd:'ffmpeg -i INPUT -vf "fade=out:120:30" OUTPUT',    desc:'淡出效果 — 画面渐隐到黑'},
  {keys:['霓虹','光晕','glow','发光'],          cmd:'ffmpeg -i INPUT -vf "gblur=sigma=3,eq=brightness=1.1:saturation=1.3" OUTPUT', desc:'霓虹光晕 — 柔光 + 饱和度提升'},
  {keys:['模糊','blur','虚化'],                 cmd:'ffmpeg -i INPUT -vf "gblur=sigma=8" OUTPUT',      desc:'高斯模糊 — 画面柔化'},
  {keys:['锐化','sharpen','清晰'],              cmd:'ffmpeg -i INPUT -vf "unsharp=5:5:1.0:5:5:0.0" OUTPUT', desc:'锐化 — 增强边缘对比'},
  {keys:['黑白','灰度','grayscale','黑白电影'],   cmd:'ffmpeg -i INPUT -vf "hue=s=0" OUTPUT',           desc:'去色 — 转为黑白'},
  {keys:['加速','快放','speed','变速快'],        cmd:'ffmpeg -i INPUT -vf "setpts=0.5*PTS" -af "atempo=2.0" OUTPUT', desc:'2倍速 — 画面+音频加速'},
  {keys:['减速','慢放','slow','慢动作'],          cmd:'ffmpeg -i INPUT -vf "setpts=2.0*PTS" -af "atempo=0.5" OUTPUT', desc:'半速 — 慢动作效果'},
  {keys:['翻转','水平翻转','flip'],               cmd:'ffmpeg -i INPUT -vf "hflip" OUTPUT',              desc:'水平翻转 — 左右镜像'},
  {keys:['垂直翻转','vflip'],                    cmd:'ffmpeg -i INPUT -vf "vflip" OUTPUT',              desc:'垂直翻转 — 上下颠倒'},
  {keys:['旋转','rotate','转动'],                cmd:'ffmpeg -i INPUT -vf "rotate=PI/6" OUTPUT',        desc:'旋转30度'},
  {keys:['裁剪','crop','裁切'],                  cmd:'ffmpeg -i INPUT -vf "crop=iw/2:ih:iw/4:0" OUTPUT', desc:'居中裁剪 — 保留中间50%'},
  {keys:['缩放','scale','缩小'],                 cmd:'ffmpeg -i INPUT -vf "scale=iw/2:ih/2" OUTPUT',    desc:'缩小至50%'},
  {keys:['画中画','pip','叠加'],                  cmd:'ffmpeg -i INPUT -i OVERLAY -filter_complex "[1]scale=iw/3:ih/3[pip];[0][pip]overlay=W-w-20:H-h-20" OUTPUT', desc:'画中画 — 右下角叠加第二个视频'},
  {keys:['静音','mute','去声音'],                 cmd:'ffmpeg -i INPUT -an OUTPUT',                      desc:'移除音频轨道'},
  {keys:['暗角','vignette','边缘暗化'],            cmd:'ffmpeg -i INPUT -vf "vignette=angle=PI/5:eval=frame" OUTPUT', desc:'暗角效果 — 画面边缘渐暗，聚焦中心'},
  {keys:['胶片颗粒','film grain','颗粒感','噪点'],   cmd:'ffmpeg -i INPUT -vf "noise=alls=35:allf=t+u" OUTPUT', desc:'胶片颗粒 — 模拟老电影噪点质感'},
  {keys:['复古','sepia','怀旧','暖色调','老照片'],   cmd:'ffmpeg -i INPUT -vf "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131" OUTPUT', desc:'复古暖色 — 经典棕褐色怀旧风格'},
  {keys:['色差','chromatic','rgb偏移','镜头色差'],   cmd:'ffmpeg -i INPUT -vf "rgbashift=rh=4:bh=-4" OUTPUT', desc:'色差效果 — RGB通道偏移，模拟镜头色差'},
  {keys:['电影宽幅','letterbox','宽银幕','遮幅'],    cmd:'ffmpeg -i INPUT -vf "drawbox=0:0:iw:ih*0.12:t=fill:c=black,drawbox=0:ih*0.88:iw:ih*0.12:t=fill:c=black" OUTPUT', desc:'电影宽幅 — 上下黑边，2.35:1 宽银幕效果'},
  {keys:['调色','色彩调整','color adjust','亮度对比'], cmd:'ffmpeg -i INPUT -vf "eq=brightness=0.05:contrast=1.2:saturation=1.3" OUTPUT', desc:'调色 — 亮度+5%，对比度+20%，饱和度+30%'},
  {keys:['反相','负片','invert','反转颜色'],       cmd:'ffmpeg -i INPUT -vf "negate" OUTPUT',              desc:'反相 — 画面颜色反转，类似底片效果'},
  {keys:['色调','色相','hue','色相偏移'],           cmd:'ffmpeg -i INPUT -vf "hue=h=90:s=1" OUTPUT',      desc:'色调旋转 — 色相偏移90度'},
  {keys:['像素化','马赛克','pixelate','mosaic','像素风'], cmd:'ffmpeg -i INPUT -vf "scale=iw/20:ih/20:flags=neighbor,scale=iw:ih:flags=neighbor" OUTPUT', desc:'像素化 — 马赛克效果，画面降低分辨率再放大'}
];

function translateEffect(text){
  var lower = text.toLowerCase();
  var inputFile = 'input.mp4', outputFile = 'output.mp4';
  try { var v = JSON.parse(localStorage.getItem(STORAGE_KEYS.VIDEO)); if(v&&v.name) inputFile = v.name; } catch(e){ console.error('[translateEffect] 读取视频信息失败:', e.message); }
  for(var i=0;i<EFFECT_MAP.length;i++){
    for(var j=0;j<EFFECT_MAP[i].keys.length;j++){
      if(lower.indexOf(EFFECT_MAP[i].keys[j])!==-1){
        var finalCmd = EFFECT_MAP[i].cmd.replace(/OUTPUT/g, outputFile).replace(/INPUT/g, inputFile);
        return { matched:true, cmd:finalCmd, desc:EFFECT_MAP[i].desc };
      }
    }
  }
  return { matched:false };
}
