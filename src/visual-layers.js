(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SRTVisualLayers = api;
})(typeof window === 'undefined' ? null : window, function() {
  'use strict';
  var FONT_FAMILY = 'Heiti SC';
  function freezeSchema(value) { Object.keys(value).forEach(function(k){Object.freeze(value[k]);}); return Object.freeze(value); }
  var SHAPE_PARAMETERS = freezeSchema({
    x: { type:'number', minimum:0, maximum:1, default:.1, description:'左边缘（画面宽度比例）' },
    y: { type:'number', minimum:0, maximum:1, default:.1, description:'上边缘（画面高度比例）' },
    width: { type:'number', minimum:.01, maximum:1, default:.3, description:'宽度（画面宽度比例）' },
    height: { type:'number', minimum:.01, maximum:1, default:.15, description:'高度（画面高度比例）' },
    color: { type:'string', pattern:'^#[0-9A-Fa-f]{6}$', default:'#000000', description:'填充颜色 #RRGGBB' },
    cornerRadius: { type:'number', minimum:0, maximum:.5, default:0, description:'圆角半径（底板较短边比例）' },
    borderWidth: { type:'number', minimum:0, maximum:.1, default:0, description:'内描边厚度（底板较短边比例）' },
    borderColor: { type:'string', pattern:'^#[0-9A-Fa-f]{6}$', default:'#FFFFFF', description:'描边颜色 #RRGGBB' },
    fillOpacity: { type:'number', minimum:0, maximum:1, default:1, description:'底板填充透明度（0 为全透明，1 为不透明）' }
  });
  var TEXT_PARAMETERS = freezeSchema({
    text: { type:'string', minLength:1, maxLength:200, pattern:'^[^\\u0000-\\u0009\\u000B\\u000C\\u000E-\\u001F\\u007F]*$', description:'纯文本，最多 8 行' },
    x: { type:'number', minimum:0, maximum:1, default:.12, description:'左边缘（画面宽度比例）' },
    y: { type:'number', minimum:0, maximum:1, default:.12, description:'虚拟顶部（画面高度比例）' },
    fontSize: { type:'number', minimum:.02, maximum:.2, default:.05, description:'字号（画面高度比例）' },
    color: { type:'string', pattern:'^#[0-9A-Fa-f]{6}$', default:'#FFFFFF', description:'纯色 #RRGGBB' }
  });
  function fail() { var e = new Error('VISUAL_LAYER_INVALID'); e.code='VISUAL_LAYER_INVALID'; throw e; }
  function plain(v) { return v && typeof v==='object' && !Array.isArray(v) && Object.getPrototypeOf(v)===Object.prototype; }
  function normalizeParams(kind, params, requireExplicit) {
    var schema = kind==='shape' ? SHAPE_PARAMETERS : kind==='text' ? TEXT_PARAMETERS : null;
    if (!schema || !plain(params)) fail();
    var names=Object.keys(params); if (requireExplicit && names.length===0) fail();
    if (names.some(function(k){return !Object.prototype.hasOwnProperty.call(schema,k);})) fail();
    var out={};
    Object.keys(schema).forEach(function(name){
      var rule=schema[name], value=params[name];
      if (value===undefined) {
        if (name==='text') fail();
        value=rule.default;
      }
      if (rule.type==='number') {
        if (typeof value!=='number'||!Number.isFinite(value)||value<rule.minimum||value>rule.maximum) fail();
      } else {
        if (typeof value!=='string') fail();
        if (name==='text') value=value.replace(/\r\n?/g,'\n');
        if ((rule.minLength!==undefined&&value.length<rule.minLength)||(rule.maxLength!==undefined&&value.length>rule.maxLength)||!new RegExp(rule.pattern).test(value)) fail();
      }
      out[name]=value;
    });
    if (kind==='shape' && (out.x+out.width>1 || out.y+out.height>1)) fail();
    if (kind==='text' && (!out.text.trim() || out.text.split('\n').length>8)) fail();
    return out;
  }
  function geometry(kind, params, width, height) {
    if (!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0) fail();
    var p=normalizeParams(kind,params,false), x=Math.round(p.x*width), y=Math.round(p.y*height);
    if(kind==='shape') {
      var shape={x:x,y:y,width:Math.max(1,Math.round(p.width*width)),height:Math.max(1,Math.round(p.height*height)),color:p.color};
      var shorter=Math.min(shape.width,shape.height);
      shape.cornerRadius=p.cornerRadius*shorter;
      shape.borderWidth=p.borderWidth*shorter;
      shape.borderColor=p.borderColor;
      shape.fillOpacity=p.fillOpacity;
      return shape;
    }
    var size=Math.max(1,Math.round(p.fontSize*height)), lineHeight=Math.max(1,Math.round(1.2*size));
    return {x:x,y:y,fontSize:size,lineHeight:lineHeight,lines:p.text.split('\n').map(function(text,i){return{text:text,x:x,baseline:y+size+i*lineHeight};}),color:p.color};
  }
  function draw(ctx,kind,params,width,height) {
    var g=geometry(kind,params,width,height); ctx.save(); ctx.fillStyle=g.color;
    if(kind==='shape') {
      if (g.cornerRadius!==0 || g.borderWidth!==0 || g.fillOpacity!==1) {
        ctx.restore();
        var unsupported=new Error('VISUAL_LAYER_UNSUPPORTED_RENDERER');
        unsupported.code='VISUAL_LAYER_UNSUPPORTED_RENDERER';
        throw unsupported;
      }
      ctx.fillRect(g.x,g.y,g.width,g.height);
    }
    else { ctx.textBaseline='alphabetic';ctx.textAlign='left';ctx.font='normal '+g.fontSize+'px '+FONT_FAMILY;g.lines.forEach(function(line){if(line.text)ctx.fillText(line.text,line.x,line.baseline);}); }
    ctx.restore(); return g;
  }
  return {FONT_FAMILY:FONT_FAMILY,SHAPE_PARAMETERS:SHAPE_PARAMETERS,TEXT_PARAMETERS:TEXT_PARAMETERS,normalizeParams:normalizeParams,geometry:geometry,draw:draw};
});
