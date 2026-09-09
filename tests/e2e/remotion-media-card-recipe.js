'use strict';
const { parseInstruction } = require('../../src/instruction-capabilities');
module.exports = function mediaCardRecipe(_text, context) {
  const assets = context.assets || [];
  const steps = ['image','video'].map((kind, index) => {
    const asset = assets.find(item => item.kind === kind);
    const range = index ? {start:2.03,end:3.85} : {start:.27,end:1.95};
    const duration = range.end - range.start;
    return {capability:'visual.group@1',range,params:{
      pivotX:.26,pivotY:.45,
      opacity:{keyframes:[{time:0,value:0},{time:.3,value:1},{time:duration-.3,value:1},{time:duration,value:0}]},
      scale:{keyframes:[{time:0,value:.96},{time:.4,value:1,easing:'ease-out'}]},
      layers:[
        {kind:'shape',params:{x:.06,y:.12,width:.4,height:.68,color:'#F6AACB',fillOpacity:.22,
          cornerRadius:.075,borderWidth:.003,borderColor:'#F9D4E4',backdropBlur:.025,
          glowBlur:.033,glowColor:'#F6AACB',glowOpacity:.4}},
        {kind,params:{assetId:asset.assetId,x:.1,y:.38,width:.32,height:.3,fit:'cover',cornerRadius:.07,
          ...(kind==='video'?{sourceStartSeconds:.5}:{})}},
        {kind:'text',params:{text:'关键时刻',x:.1,y:.17,fontSize:.075,fontWeight:800,
          shadowBlur:.2,shadowColor:'#371C2B',shadowOpacity:.4}},
        {kind:'text',params:{text:'素材与观点，一起呈现',x:.1,y:.29,fontSize:.035,fontWeight:400}},
        {kind:'text',params:{text:'KEY MOMENT',x:.1,y:.72,fontSize:.025,fontWeight:600,letterSpacing:.15}}
      ]}};
  });
  return parseInstruction(JSON.stringify({kind:'instruction',steps}));
};
