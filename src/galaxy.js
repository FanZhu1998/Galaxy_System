import { TAU, G_AU, AU_YR_TO_KM_S, angularRate, solveKepler } from './physics.js';
import { systems } from './systems.js';
import { initializeIcons } from '../vendor/lucide/icons.js';

initializeIcons();
const root = document.getElementById('astra-gravity');
const $ = selector => root.querySelector(selector);
const canvas = $('canvas');
const loading = $('[data-loading]');
try {
  const THREE = await import('../vendor/three/three.module.js');
  if (!root.isConnected) throw new Error('Visualization closed');
  let seed = 20260913;
  function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
  function normal() { return Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(TAU * random()); }
  const palette = {};
  const cssProbe = document.createElement('span');
  cssProbe.hidden = true;
  root.appendChild(cssProbe);
  function readColor(name) { cssProbe.style.color = 'var(--' + name + ')'; return new THREE.Color(getComputedStyle(cssProbe).color); }
  function readPalette() {
    ['space','space-ink','space-muted','gold','ice','violet','emission','planet-blue','planet-clay','planet-green','planet-sand','orbit'].forEach(k => palette[k] = readColor(k));
  }
  readPalette();
  const compactDevice = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'default', depth: true, stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactDevice ? 1.25 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(palette.space);
  const galaxyScene = new THREE.Scene();
  const systemScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, .015, 1400);
  const galaxyGroup = new THREE.Group();
  galaxyScene.add(galaxyGroup);
  const systemGroup = new THREE.Group();
  systemScene.add(systemGroup);
  const reusable = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const clockDisplay = $('[data-clock]');
  const detail = $('[data-detail]');
  const labelsLayer = $('.astra-label-layer');
  const speedControl = $('#astra-speed');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = !reducedMotion.matches;
  let galaxyTime = 0, systemTime = 0, timeMultiplier = 1;
  let view = 'galaxy', systemIndex = -1, selectedPlanet = -1;
  let width = 736, height = 510, isVisible = true;
  let lastTime = performance.now(), lastReadout = 0, lastLabels = 0;
  let frameRequest = 0, disposed = false, dirty = true;
  const eventController = new AbortController();
  function listen(target, type, handler, options = {}) { target.addEventListener(type, handler, {...options, signal: eventController.signal}); }
  function wake() { if (!frameRequest && !disposed && isVisible && !document.hidden) { lastTime = performance.now(); frameRequest = requestAnimationFrame(render); } dirty = true; }
  let lastCameraInput = 0, topView = false;
  let targetAzimuth = .27, azimuth = .27, targetPolar = 1.02, polar = 1.02;
  let targetDistance = 48, distance = 48;
  let transition = null;
  const pointVertex = `
    attribute vec3 aColor;
    attribute float aSize;
    varying vec3 vColor;
    varying float vOpacity;
    uniform float uPixel;
    #ifdef GALACTIC_ORBITS
      attribute vec4 aOrbit;
      attribute vec4 aPlane;
      uniform float uTime;
      uniform sampler2D uDensity;
    #endif
    void main() {
      vColor = aColor;
      vec3 p = position;
      vOpacity = 1.0;
      #ifdef GALACTIC_ORBITS
        float angle = aOrbit.y + aOrbit.z * uTime;
        float x = aOrbit.x * cos(angle), z = aOrbit.x * sin(angle);
        p = vec3(x*aPlane.z-z*aPlane.x*aPlane.w, z*aPlane.y, x*aPlane.w+z*aPlane.x*aPlane.z);
        float dust = texture2D(uDensity, position.xz / 42.0 + 0.5).b;
        vOpacity = exp(-dust*2.8*smoothstep(-0.22,0.22,-p.y*sign(cameraPosition.y)));
      #endif
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(aSize * uPixel * 210.0 / max(1.0, -mv.z), 1.0, 38.0 * uPixel);
    }`;
  const pointFragment = `
    varying vec3 vColor;
    varying float vOpacity;
    uniform float uOpacity;
    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float r = length(p) * 2.0;
      if (r > 1.0) discard;
      float glow = exp(-5.0*r*r)*0.36 + exp(-32.0*r*r)*0.8;
      gl_FragColor = vec4(vColor, glow * uOpacity * vOpacity * (1.0 - smoothstep(0.75, 1.0, r)));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  function pointCloud(positions, colors, sizes, opacity = 1) {
    const geometry = new THREE.BufferGeometry();
    const buffer = values => values instanceof Float32Array ? values : new Float32Array(values);
    geometry.setAttribute('position', new THREE.BufferAttribute(buffer(positions), 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(buffer(colors), 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(buffer(sizes), 1));
    const material = new THREE.ShaderMaterial({ vertexShader: pointVertex, fragmentShader: pointFragment, uniforms: { uOpacity: {value: opacity}, uPixel: {value: renderer.getPixelRatio()} }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const cloud = new THREE.Points(geometry, material);
    cloud.frustumCulled = false;
    return cloud;
  }
  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const context = c.getContext('2d');
    const gradient = context.createRadialGradient(64,64,0,64,64,64);
    // This grayscale mask carries opacity only; the scene palette supplies color.
    gradient.addColorStop(0,'rgba(255,255,255,1)');
    gradient.addColorStop(.08,'rgba(255,255,255,.95)');
    gradient.addColorStop(.2,'rgba(255,255,255,.35)');
    gradient.addColorStop(.55,'rgba(255,255,255,.065)');
    gradient.addColorStop(1,'rgba(255,255,255,0)');
    context.fillStyle = gradient; context.fillRect(0,0,128,128);
    return new THREE.CanvasTexture(c);
  }
  const glowMap = glowTexture();
  const themedMaterials = [];
  function sprite(colorKey, size, opacity, group) {
    const material = new THREE.SpriteMaterial({map: glowMap, color: palette[colorKey], opacity, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false});
    themedMaterials.push({material, key:colorKey});
    const object = new THREE.Sprite(material); object.scale.set(size,size,1); group.add(object); return object;
  }
  const backgroundPositions = [], backgroundColors = [], backgroundSizes = [], backgroundKeys = [], backgroundBrightness = [];
  for (let i=0; i<1100; i++) {
    const r=250+random()*240, z=random()*2-1, a=random()*TAU, s=Math.sqrt(1-z*z);
    backgroundPositions.push(r*s*Math.cos(a),r*z,r*s*Math.sin(a));
    const key=i%7===0?'gold':'ice';
    const brightness=.16+random()*.42; backgroundBrightness.push(brightness);
    const color=palette[key].clone().multiplyScalar(brightness);
    backgroundColors.push(color.r,color.g,color.b); backgroundKeys.push(key);
    backgroundSizes.push(1+random()*2.7);
  }
  const background = pointCloud(backgroundPositions, backgroundColors, backgroundSizes, .5);
  background.renderOrder = -300;
  galaxyScene.add(background);
  const systemBackground = new THREE.Points(background.geometry, background.material);
  systemBackground.frustumCulled = false; systemScene.add(systemBackground);
  // Bake irregular stellar emission and dust ONCE. No images, texture downloads, or per-frame noise generation.
  const screenGeometry = new THREE.PlaneGeometry(2, 2);
  const passCamera = new THREE.Camera();
  const screenVertex = `varying vec2 vUv; void main(){vUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}`;
  const densityTarget = new THREE.WebGLRenderTarget(512, 512, {depthBuffer:false, stencilBuffer:false, minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter});
  const bakeMaterial = new THREE.ShaderMaterial({
    vertexShader:screenVertex, depthTest:false, depthWrite:false, toneMapped:false,
    fragmentShader:`
      varying vec2 vUv;
      float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float f=0.0,a=0.5;mat2 m=mat2(1.61,1.17,-1.17,1.61);for(int i=0;i<5;i++){f+=a*noise(p);p=m*p+13.7;a*=0.5;}return f;}
      void main(){
        vec2 p=(vUv-0.5)*42.0;
        vec2 warp=vec2(fbm(p*.36+17.0),fbm(p*.36+41.0))-.5;
        vec2 q=p+warp*.8;
        float r=length(q),theta=atan(q.y,q.x);
        float coarse=fbm(q*.58),fine=fbm(q*2.15+31.0);
        float phase=theta-log(max(r,.4)/1.2)*2.15+(coarse-.5)*.48;
        float mainArm=exp(-pow(sin(phase),2.0)*(25.0+r*.6));
        float branch=exp(-pow(cos(phase+.15*sin(r*.7)),2.0)*49.0)*.27;
        float arms=mainArm+branch;
        float disk=exp(-r/6.1)*(1.0-smoothstep(13.5,20.0,r));
        float knots=smoothstep(.48,.76,fine)*smoothstep(1.8,4.0,r);
        float emission=disk*(.13+arms*.8)*(.62+fine*.95);
        float young=disk*arms*(.38+knots*.7)*smoothstep(1.5,4.0,r);
        float leading=exp(-pow(sin(phase+.16+(fine-.5)*.23),2.0)*95.0);
        float dust=(leading*.85+arms*.36)*(.35+coarse*.85+fine*.35)*smoothstep(1.0,2.8,r)*(1.0-smoothstep(12.0,19.0,r));
        float ionized=knots*knots*mainArm*disk*.78;
        gl_FragColor=clamp(vec4(emission,young,dust,ionized),0.0,1.0);
      }`
  });
  const bakeScene = new THREE.Scene();bakeScene.add(new THREE.Mesh(screenGeometry,bakeMaterial));
  renderer.setRenderTarget(densityTarget);renderer.render(bakeScene,passCamera);renderer.setRenderTarget(null);
  bakeMaterial.dispose();bakeScene.clear();
  // Low-resolution volume: front-to-back emission plus dust extinction, with an analytic oblate bulge.
  // The diffuse gas is an illustrative tracer field, not a hydrodynamics calculation.
  let volumeScale=compactDevice?.48:.64, volumeDirty=true;
  const volumeTarget = new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false,type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  const inverseViewProjection = new THREE.Matrix4();
  const volumeMaterial = new THREE.ShaderMaterial({
    vertexShader:screenVertex, depthTest:false, depthWrite:false, toneMapped:false,
    uniforms:{uDensity:{value:densityTarget.texture},uInverse:{value:inverseViewProjection},uEye:{value:camera.position},uTime:{value:0},uWarm:{value:palette.gold},uCool:{value:palette.ice},uEmission:{value:palette.emission},uSteps:{value:compactDevice?16:22}},
    fragmentShader:`
      varying vec2 vUv;
      uniform sampler2D uDensity;
      uniform mat4 uInverse;
      uniform vec3 uEye,uWarm,uCool,uEmission;
      uniform float uTime;
      uniform int uSteps;
      float omega(float r){r=max(r,.15);float v2=258054.6*r/((r+3.0)*(r+3.0))+32400.0*r*r/(r*r+25.0)+18.493913/r;return sqrt(v2)/r*.001022712165;}
      vec4 sampleDisk(vec3 p){
        float a=omega(length(p.xz))*uTime,c=cos(a),s=sin(a);
        vec2 rest=vec2(c*p.x+s*p.z,-s*p.x+c*p.z);
        return texture2D(uDensity,rest/42.0+.5);
      }
      float bulgeIntegral(vec3 ro,vec3 rd,vec3 scale){
        vec3 o=ro*scale,d=rd*scale;
        float a=dot(d,d),b=dot(o,d),perp=max(0.0,dot(o,o)-b*b/a);
        return exp(-.5*perp)*sqrt(6.2831853/a);
      }
      void main(){
        vec4 farPoint=uInverse*vec4(vUv*2.0-1.0,1.0,1.0);
        vec3 ro=uEye,rd=normalize(farPoint.xyz/farPoint.w-ro);
        vec3 safeRay=vec3(rd.x<0.0?-max(abs(rd.x),.00001):max(abs(rd.x),.00001),rd.y<0.0?-max(abs(rd.y),.00001):max(abs(rd.y),.00001),rd.z<0.0?-max(abs(rd.z),.00001):max(abs(rd.z),.00001));
        vec3 t0=(-vec3(21.0,.9,21.0)-ro)/safeRay,t1=(vec3(21.0,.9,21.0)-ro)/safeRay;
        vec3 lo=min(t0,t1),hi=max(t0,t1);
        float nearT=max(max(lo.x,lo.y),max(lo.z,0.0)),farT=min(min(hi.x,hi.y),hi.z);
        float centerT=-dot(ro,rd);
        vec3 bulge=uWarm*(bulgeIntegral(ro,rd,vec3(.72,1.65,.72))*.39+bulgeIntegral(ro,rd,vec3(2.4,3.7,2.4))*.9);
        if(centerT<0.0)bulge=vec3(0.0);
        if(farT<=nearT){gl_FragColor=vec4(bulge,0.0);return;}
        float stepSize=(farT-nearT)/float(uSteps);
        float transmittance=1.0,coreTransmission=1.0;
        vec3 light=vec3(0.0);
        for(int i=0;i<32;i++){
          if(i>=uSteps)break;
          float t=nearT+(float(i)+.5)*stepSize;
          vec3 p=ro+rd*t;
          float r=length(p.xz);
          vec4 field=sampleDisk(p);
          float heightScale=.13+.008*r;
          float stars=exp(-abs(p.y)/heightScale);
          float gas=exp(-abs(p.y)/(.075+.004*r));
          float extinction=field.b*gas*6.8+field.r*stars*.10;
          float transmission=exp(-extinction*stepSize);
          vec3 continuum=mix(uWarm,uCool,smoothstep(2.0,8.0,r));
          vec3 emissivity=(continuum*field.r*1.8+uCool*field.g*.9)*stars+uEmission*field.a*gas*1.9;
          float integral=extinction>.0001?(1.0-transmission)/extinction:stepSize;
          light+=transmittance*emissivity*integral;
          transmittance*=transmission;
          if(t<centerT)coreTransmission=transmittance;
          if(transmittance<.008)break;
        }
        light+=bulge*coreTransmission;
        gl_FragColor=vec4(light,1.0-transmittance);
      }`
  });
  const volumeScene=new THREE.Scene();volumeScene.add(new THREE.Mesh(screenGeometry,volumeMaterial));
  const compositeMaterial=new THREE.ShaderMaterial({
    vertexShader:screenVertex,uniforms:{uVolume:{value:volumeTarget.texture}},depthTest:false,depthWrite:false,transparent:true,
    blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,
    fragmentShader:`varying vec2 vUv;uniform sampler2D uVolume;void main(){gl_FragColor=texture2D(uVolume,vUv);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
  });
  const nebulaComposite=new THREE.Mesh(screenGeometry,compositeMaterial);nebulaComposite.frustumCulled=false;nebulaComposite.renderOrder=-200;galaxyScene.add(nebulaComposite);
  function drawVolume(){
    inverseViewProjection.multiplyMatrices(camera.matrixWorld,camera.projectionMatrixInverse);
    volumeMaterial.uniforms.uTime.value=galaxyTime;
    volumeMaterial.uniforms.uSteps.value=Math.abs(Math.cos(polar))<.22?(compactDevice?24:32):(compactDevice?16:22);
    renderer.setRenderTarget(volumeTarget);renderer.render(volumeScene,passCamera);renderer.setRenderTarget(null);volumeDirty=false;
  }
  const STAR_COUNT = 24000;
  const positions = new Float32Array(STAR_COUNT*3), colors = new Float32Array(STAR_COUNT*3), sizes = new Float32Array(STAR_COUNT);
  const orbitAttributes=new Float32Array(STAR_COUNT*4),planeAttributes=new Float32Array(STAR_COUNT*4);
  const starKeys = new Uint8Array(STAR_COUNT), starBrightness = new Float32Array(STAR_COUNT);
  for (let i=0; i<STAR_COUNT; i++) {
    const bulge = i<3300;
    const r = bulge ? .1+Math.pow(random(),1.7)*3.8 : .7+Math.min(18,-Math.log(Math.max(.0001,random()*random()))*3.1);
    const arm = (i%5===0?1:0)*Math.PI/2+(i%2)*Math.PI;
    const phase = bulge || i%7===0 ? random()*TAU : arm+Math.log(r/1.2)*2.15+normal()*(.11+.35/r);
    const inclination=bulge?Math.acos(2*random()-1):normal()*(.021+.05/r);
    const node=bulge?random()*TAU:0;
    const key = bulge || r<3 ? 0 : random()<.83?1:2;
    starKeys[i]=key; starBrightness[i]=.34+random()*.58;
    const c = palette[['gold','ice','space-ink'][key]].clone().multiplyScalar(starBrightness[i]);
    colors.set([c.r,c.g,c.b],i*3);
    sizes[i]=bulge?.24+random()*.32:.20+Math.pow(random(),6)*.97;
    const ci=Math.cos(inclination),si=Math.sin(inclination),cn=Math.cos(node),sn=Math.sin(node);
    orbitAttributes.set([r,phase,angularRate(r),0],i*4);planeAttributes.set([ci,si,cn,sn],i*4);
    const x=r*Math.cos(phase),z=r*Math.sin(phase);positions.set([x*cn-z*ci*sn,z*si,x*sn+z*ci*cn],i*3);
  }
  const stars = pointCloud(positions,colors,sizes,.57);
  stars.geometry.setAttribute('aOrbit',new THREE.BufferAttribute(orbitAttributes,4));
  stars.geometry.setAttribute('aPlane',new THREE.BufferAttribute(planeAttributes,4));
  stars.material.defines={GALACTIC_ORBITS:1};
  stars.material.uniforms.uTime={value:0};stars.material.uniforms.uDensity={value:densityTarget.texture};
  galaxyGroup.add(stars);

  const galaxyPaths = new THREE.Group(); galaxyGroup.add(galaxyPaths);
  galaxyPaths.visible=false;
  const markers = [], galaxyLabels = [];
  const orbitMaterial = new THREE.LineBasicMaterial({color:palette.orbit,transparent:true,opacity:.22,depthWrite:false});
  themedMaterials.push({material:orbitMaterial,key:'orbit'});
  function orbitPosition(r, phase, inclination, node, target) {
    const x=r*Math.cos(phase), z=r*Math.sin(phase), ci=Math.cos(inclination), si=Math.sin(inclination), cn=Math.cos(node), sn=Math.sin(node);
    return target.set(x*cn-z*ci*sn,z*si,x*sn+z*ci*cn);
  }
  let labelSizesDirty=true;
  function label(text) { const element=document.createElement('span'); element.className='astra-label text-small'; element.textContent=text; labelsLayer.appendChild(element); labelSizesDirty=true; return element; }
  systems.forEach((s,i)=>{
    const markerGroup = new THREE.Group(); galaxyGroup.add(markerGroup);
    sprite(s.color,.68,.7,markerGroup);
    const core = new THREE.Mesh(new THREE.SphereGeometry(.025,10,6),new THREE.MeshBasicMaterial({color:palette[s.color],transparent:true,depthWrite:false}));
    themedMaterials.push({material:core.material,key:s.color}); markerGroup.add(core);
    markers.push(markerGroup); galaxyLabels.push(label(s.name));
    const path=[];
    for(let j=0;j<=192;j++) path.push(orbitPosition(s.radius,TAU*j/192,s.inc,0,new THREE.Vector3()));
    galaxyPaths.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(path),orbitMaterial));
  });
  let lastGalaxyRenderedTime = -1;
  function updateGalaxy() {
    if (galaxyTime === lastGalaxyRenderedTime) return;
    lastGalaxyRenderedTime = galaxyTime;
    // One uniform update replaces 24,000 CPU orbit calculations and a 288 KB position upload per frame.
    stars.material.uniforms.uTime.value=galaxyTime;
    systems.forEach((s,i)=>orbitPosition(s.radius,s.angle+angularRate(s.radius)*galaxyTime,s.inc,0,markers[i].position));
  }
  const planetVertex=`
    varying vec3 vNormal;
    varying vec3 vWorld;
    varying vec3 vLocal;
    void main(){vLocal=position;vNormal=normalize(mat3(modelMatrix)*normal);vWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.0);}`;
  const planetFragment=`
    varying vec3 vNormal; varying vec3 vWorld; varying vec3 vLocal;
    uniform vec3 uBase; uniform vec3 uLight; uniform float uGas; uniform float uSeed; uniform float uOcean;
    float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
    float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
    void main(){
      vec3 p=normalize(vLocal),n=normalize(vNormal),l=normalize(-vWorld),eye=normalize(cameraPosition-vWorld);
      float diffuse=max(0.0,dot(n,l));
      float f=noise(p*5.0+uSeed)*.6+noise(p*13.0+uSeed)*.27+noise(p*31.0+uSeed)*.13;
      float bands=.63+.22*sin(p.y*43.0+f*9.0)+.11*sin(p.y*87.0+f*6.0);
      float terrain=smoothstep(.46,.57,f);
      vec3 rock=uBase*(.48+f*.85);
      vec3 ocean=mix(uBase*.72,mix(uBase,vec3(.30,.44,.25),.66),terrain);
      vec3 base=mix(mix(rock,ocean,uOcean),uBase*bands,uGas);
      float cloud=smoothstep(.62,.78,noise(p*9.0+vec3(0.0,uSeed,3.0))*.7+noise(p*23.0)*.3);
      base=mix(base,uLight*.84,cloud*.65*(1.0-uGas)*uOcean);
      float rim=pow(1.0-max(dot(n,eye),0.0),3.3)*pow(max(dot(n,l)+.32,0.0),1.5);
      float spec=pow(max(dot(reflect(-l,n),eye),0.0),35.0)*uOcean*(1.0-terrain)*.38;
      vec3 color=base*(.045+diffuse*1.5)+uBase*rim*.62+uLight*spec;
      gl_FragColor=vec4(color,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const starFragment=`
    varying vec3 vNormal; varying vec3 vWorld; varying vec3 vLocal;
    uniform vec3 uBase; uniform float uTime;
    void main(){vec3 n=normalize(vNormal),eye=normalize(cameraPosition-vWorld);float limb=.55+.45*max(dot(n,eye),0.0);float granules=sin(vLocal.x*147.0+sin(vLocal.y*70.0))*sin(vLocal.z*110.0+uTime*.3);gl_FragColor=vec4(uBase*(1.8+granules*.14)*limb,1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`;
  const planetGeometry=new THREE.SphereGeometry(1,48,32);
  let planetObjects=[], planetLabels=[], currentOrbits=new THREE.Group(), currentSystemResources=[];
  let starSurface=null, selectionRing=null;
  const ellipsePoint=new THREE.Vector3();
  function planetPosition(planet,t,target){
    const M=((planet.phase+TAU*t/planet.period)%TAU+TAU)%TAU;
    const E=solveKepler(M,planet.e);
    return target.set(planet.a*(Math.cos(E)-planet.e),0,planet.a*Math.sqrt(1-planet.e*planet.e)*Math.sin(E)).applyQuaternion(planet.orientation);
  }
  function clearSystem(){
    planetLabels.forEach(element=>element.remove());planetLabels=[];
    currentSystemResources.forEach(resource=>resource.dispose());currentSystemResources=[];
    systemGroup.clear();planetObjects=[];
  }
  function buildSystem(index){
    clearSystem();const s=systems[index];
    const starRadius=.135*Math.pow(s.mass,.6);
    starSurface=new THREE.Mesh(planetGeometry,new THREE.ShaderMaterial({vertexShader:planetVertex,fragmentShader:starFragment,uniforms:{uBase:{value:palette[s.color]},uTime:{value:systemTime}}}));
    starSurface.scale.setScalar(starRadius);systemGroup.add(starSurface);currentSystemResources.push(starSurface.material);
    const coronaMaterial=new THREE.SpriteMaterial({map:glowMap,color:palette[s.color],opacity:.78,blending:THREE.AdditiveBlending,depthWrite:false});
    const corona=new THREE.Sprite(coronaMaterial);corona.scale.setScalar(starRadius*15);systemGroup.add(corona);currentSystemResources.push(coronaMaterial);
    starSurface.userData.coronaMaterial=coronaMaterial;
    currentOrbits=new THREE.Group();systemGroup.add(currentOrbits);currentOrbits.visible=$('[data-orbits]').checked;
    const orbitMat=new THREE.LineBasicMaterial({color:palette.orbit,transparent:true,opacity:.42,depthWrite:false});currentSystemResources.push(orbitMat);
    s.planets.forEach((data,i)=>{
      const [name,a,e,radius,color,ring]=data;
      const p={name,a,e,radius,color,ring,phase:1.0+i*2.12+index*.61,period:Math.sqrt(a*a*a/s.mass),orientation:new THREE.Quaternion().setFromEuler(new THREE.Euler((i-1.5)*.026,.47*i+.28*index,0)),position:new THREE.Vector3()};
      const material=new THREE.ShaderMaterial({vertexShader:planetVertex,fragmentShader:planetFragment,uniforms:{uBase:{value:palette[color]},uLight:{value:palette['space-ink']},uGas:{value:radius>.145?1:0},uSeed:{value:index*3.71+i*7.3},uOcean:{value:color==='planet-blue'||color==='planet-green'?1:0}}});
      p.mesh=new THREE.Mesh(planetGeometry,material);p.mesh.scale.setScalar(radius);systemGroup.add(p.mesh);currentSystemResources.push(material);
      p.mesh.rotation.z=.16+i*.16;
      p.label=label(name);planetLabels.push(p.label);
      const path=[];
      for(let j=0;j<=256;j++){const E=TAU*j/256;path.push(new THREE.Vector3(a*(Math.cos(E)-e),0,a*Math.sqrt(1-e*e)*Math.sin(E)).applyQuaternion(p.orientation));}
      const pathGeometry=new THREE.BufferGeometry().setFromPoints(path);currentSystemResources.push(pathGeometry);currentOrbits.add(new THREE.Line(pathGeometry,orbitMat));
      if(ring){
        const ringGeometry=new THREE.RingGeometry(radius*1.42,radius*2.3,100,3);
        const ringMat=new THREE.MeshBasicMaterial({color:palette[color],side:THREE.DoubleSide,transparent:true,opacity:.39,depthWrite:false});
        p.ringMesh=new THREE.Mesh(ringGeometry,ringMat);p.ringMesh.rotation.set(Math.PI/2+.26,0,.26);systemGroup.add(p.ringMesh);currentSystemResources.push(ringGeometry,ringMat);
        const thinGeometry=new THREE.RingGeometry(radius*2.36,radius*2.43,100);
        const thinMat=new THREE.MeshBasicMaterial({color:palette[color],side:THREE.DoubleSide,transparent:true,opacity:.2,depthWrite:false});
        p.outerRing=new THREE.Mesh(thinGeometry,thinMat);p.outerRing.rotation.copy(p.ringMesh.rotation);systemGroup.add(p.outerRing);currentSystemResources.push(thinGeometry,thinMat);
      }
      planetObjects.push(p);
    });
    const select=$('[data-planet]');select.replaceChildren(new Option('System overview','-1'));
    planetObjects.forEach((p,i)=>select.add(new Option(p.name,String(i))));
    const ringGeometry=new THREE.RingGeometry(1,1.035,80);
    const ringMaterial=new THREE.MeshBasicMaterial({color:palette.gold,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false});
    selectionRing=new THREE.Mesh(ringGeometry,ringMaterial);selectionRing.visible=false;systemGroup.add(selectionRing);currentSystemResources.push(ringGeometry,ringMaterial);
    updateSystem();
  }
  function updateSystem(){
    for(const p of planetObjects){
      planetPosition(p,systemTime,p.position);p.mesh.position.copy(p.position);
      p.mesh.rotation.y=systemTime*.8/(1+p.a*.1);
      if(p.ringMesh){p.ringMesh.position.copy(p.position);p.outerRing.position.copy(p.position);}
    }
    if(starSurface)starSurface.material.uniforms.uTime.value=systemTime;
    if(selectionRing){selectionRing.visible=selectedPlanet>=0;if(selectedPlanet>=0){const p=planetObjects[selectedPlanet];selectionRing.position.copy(p.position);selectionRing.quaternion.copy(camera.quaternion);selectionRing.scale.setScalar(p.radius*(p.ring?2.7:1.65));}}
  }
  function baseRate(){return view==='galaxy'?3:.12;}
  function updateRate(){
    const rate=baseRate()*timeMultiplier;const unit=view==='galaxy'?'Myr / s':'yr / s';
    $('[data-rate]').textContent=(rate<1?rate.toFixed(3).replace(/0+$/,'').replace(/\.$/,''):rate.toFixed(1))+' '+unit;
    speedControl.setAttribute('aria-valuetext',$('[data-rate]').textContent);
  }
  function updateDetail(){
    if(view==='galaxy')detail.textContent='6 synthetic solar systems · 24,000 tracer stars · Smooth galactic gravity';
    else if(selectedPlanet<0){const s=systems[systemIndex];detail.textContent=s.name+' · '+s.type+' · '+s.mass.toFixed(2)+' M☉ · '+s.planets.length+' planets';}
    else {const p=planetObjects[selectedPlanet],s=systems[systemIndex];detail.textContent=p.name+' · '+p.a.toFixed(2)+' AU semimajor axis · '+p.period.toFixed(2)+' yr orbit · e = '+p.e.toFixed(3);}
  }
  function syncPlay(){const b=$('[data-play]');b.textContent=playing?'Pause':'Play';b.setAttribute('aria-pressed',String(!playing));}
  function cameraBounds(){return view==='galaxy'?[9,Math.max(90,fitDistance()*1.6)]:[.65,Math.max(systems[systemIndex].planets.at(-1)[1]*7,fitDistance()*1.6)];}
  function fitDistance(){const f=1/Math.min(1,width/height);return view==='galaxy'?46*f:systems[systemIndex].planets.at(-1)[1]*3.7*f;}
  function enterSystem(index){
    view='system';systemIndex=index;selectedPlanet=-1;
    buildSystem(index);galaxyLabels.forEach(e=>e.hidden=true);
    $('[data-view]').value=String(index);$('[data-planet-field]').hidden=false;
    $('[data-heading]').textContent=systems[index].name.toUpperCase()+' SYSTEM';$('[data-scale]').textContent='astronomical units · AU';
    cameraTarget.set(0,0,0);targetPolar=.77;targetAzimuth=.25;topView=false;
    targetDistance=fitDistance();distance=targetDistance*(reducedMotion.matches?1:1.35);polar=targetPolar;azimuth=targetAzimuth;
    labelSizesDirty=true;lastLabels=0;updateCameraLabel();updateRate();updateDetail();
  }
  function enterGalaxy(){
    transition=null;view='galaxy';systemIndex=-1;selectedPlanet=-1;
    planetLabels.forEach(e=>e.hidden=true);galaxyLabels.forEach(e=>e.hidden=false);
    $('[data-view]').value='galaxy';$('[data-planet-field]').hidden=true;
    $('[data-heading]').textContent='SPIRAL GALAXY';$('[data-scale]').textContent='kiloparsecs · kpc';
    cameraTarget.set(0,0,0);targetDistance=fitDistance();distance=targetDistance;targetPolar=1.02;targetAzimuth=.27;polar=targetPolar;azimuth=targetAzimuth;topView=false;
    volumeDirty=true;labelSizesDirty=true;lastLabels=0;updateCameraLabel();updateRate();updateDetail();
  }
  function chooseView(value){
    if(value==='galaxy'){enterGalaxy();return;}
    const index=Number(value);if(!Number.isInteger(index)||index<0||index>=systems.length)return;
    if(view==='galaxy'&&!reducedMotion.matches){transition={start:performance.now(),index,initialTarget:cameraTarget.clone(),initialDistance:distance};galaxyLabels.forEach(e=>e.hidden=true);}
    else {transition=null;enterSystem(index);}
  }
  listen($('[data-view]'),'change',event=>chooseView(event.target.value));
  listen($('[data-play]'),'click',()=>{playing=!playing;syncPlay();});
  listen(reducedMotion,'change',event=>{if(event.matches){playing=false;syncPlay();wake();}});
  listen($('[data-orbits]'),'change',event=>{galaxyPaths.visible=event.target.checked;currentOrbits.visible=event.target.checked;});
  listen(speedControl,'input',()=>{timeMultiplier=10**Number(speedControl.value);updateRate();});
  function choosePlanet(index){selectedPlanet=index;$('[data-planet]').value=String(index);planetObjects.forEach((p,i)=>p.label.classList.toggle('is-active',i===index));updateDetail();}
  listen($('[data-planet]'),'change',event=>choosePlanet(Number(event.target.value)));
  function updateCameraLabel(){
    $('[data-orientation]').textContent=topView?'TOP VIEW':'OBLIQUE VIEW';
    const button=$('[data-camera="tilt"]');button.textContent=topView?'Tilt view':'Top view';button.setAttribute('aria-pressed',String(topView));
  }
  root.querySelectorAll('[data-camera]').forEach(button=>listen(button,'click',()=>{
    lastCameraInput=performance.now();const action=button.dataset.camera;const [min,max]=cameraBounds();
    if(action==='left')targetAzimuth-=.3;
    if(action==='right')targetAzimuth+=.3;
    if(action==='in')targetDistance=Math.max(min,targetDistance*.75);
    if(action==='out')targetDistance=Math.min(max,targetDistance/ .75);
    if(action==='tilt'){topView=!topView;targetPolar=topView?.015:1.02;updateCameraLabel();}
  }));
  const pointers=new Map();let down=null,pinchDistance=0,dragged=false;
  listen(canvas,'pointerdown',event=>{
    if(transition)return;
    canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1){down={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY};dragged=false;}
    else {const p=[...pointers.values()];pinchDistance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);dragged=true;}
    lastCameraInput=performance.now();
  });
  listen(canvas,'pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});lastCameraInput=performance.now();
    if(pointers.size===2){const p=[...pointers.values()];const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);const [min,max]=cameraBounds();if(d>0&&pinchDistance>0)targetDistance=THREE.MathUtils.clamp(targetDistance*pinchDistance/d,min,max);pinchDistance=d;return;}
    if(!down)return;
    if(Math.hypot(event.clientX-down.startX,event.clientY-down.startY)>5)dragged=true;
    targetAzimuth-=(event.clientX-down.x)*.005;
    targetPolar=THREE.MathUtils.clamp(targetPolar-(event.clientY-down.y)*.005,.03,Math.PI-.03);
    down.x=event.clientX;down.y=event.clientY;topView=false;updateCameraLabel();
  });
  function hitTest(x,y){
    const rect=canvas.getBoundingClientRect();let best=-1,bestDistance=27;
    const objects=view==='galaxy'?markers:planetObjects.map(p=>p.mesh);
    objects.forEach((obj,i)=>{reusable.copy(obj.position).project(camera);if(reusable.z<-1||reusable.z>1)return;const px=(reusable.x*.5+.5)*width,py=(-reusable.y*.5+.5)*height;const d=Math.hypot(px-(x-rect.left),py-(y-rect.top));if(d<bestDistance){bestDistance=d;best=i;}});
    if(best>=0){if(view==='galaxy')chooseView(String(best));else choosePlanet(best);}
  }
  function releasePointer(event){
    if(!pointers.has(event.pointerId))return;
    if(event.type==='pointerup'&&pointers.size===1&&!dragged&&down)hitTest(event.clientX,event.clientY);
    pointers.delete(event.pointerId);down=null;
    if(pointers.size===1){const p=[...pointers.values()][0];down={x:p.x,y:p.y,startX:p.x,startY:p.y};dragged=true;}
  }
  listen(canvas,'pointerup',releasePointer);listen(canvas,'pointercancel',releasePointer);
  listen(canvas,'wheel',event=>{event.preventDefault();if(transition)return;const[min,max]=cameraBounds();targetDistance=THREE.MathUtils.clamp(targetDistance*Math.exp(event.deltaY*.001),min,max);lastCameraInput=performance.now();},{passive:false});
  const projected=[];
  function updateLabels(){
    const list=view==='galaxy'?galaxyLabels:planetLabels;
    const bottomLimit=height-$('.astra-bottom').offsetHeight-27;
    if(labelSizesDirty){
      list.forEach(element=>element.hidden=false);
      const dimensions=list.map(element=>[element.offsetWidth,element.offsetHeight]);
      list.forEach((element,i)=>{element._astraWidth=dimensions[i][0];element._astraHeight=dimensions[i][1];});
      labelSizesDirty=false;
    }
    const boxes=[];projected.length=0;
    for(let i=0;i<list.length;i++){const position=view==='galaxy'?markers[i].position:planetObjects[i].position;reusable.copy(position).project(camera);projected.push({i,x:(reusable.x*.5+.5)*width,y:(-reusable.y*.5+.5)*height,z:reusable.z});}
    if(view!=='galaxy')projected.sort((a,b)=>(a.i===selectedPlanet?-1:b.i===selectedPlanet?1:a.z-b.z));
    for(const p of projected){
      const element=list[p.i];if(!element)continue;
      if(transition||p.z<-1||p.z>1||p.x<8||p.x>width-8||p.y<48||p.y>bottomLimit){element.hidden=true;continue;}
      element.hidden=false;
      const ew=element._astraWidth,eh=element._astraHeight;
      const possible=[[p.x+10,p.y-eh-4],[p.x+10,p.y+7],[p.x-ew-10,p.y-eh-4],[p.x-ew-10,p.y+7]];
      let found=null;
      for(const [x,y]of possible){if(x<10||x+ew>width-10||y<50||y+eh>bottomLimit)continue;if(boxes.some(b=>x<b.x+b.w+5&&x+ew+5>b.x&&y<b.y+b.h+4&&y+eh+4>b.y))continue;found={x,y,w:ew,h:eh};break;}
      if(found){element.style.transform='translate('+Math.round(found.x)+'px,'+Math.round(found.y)+'px)';boxes.push(found);}else element.hidden=true;
    }
  }
  function resize(){
    const oldFit=fitDistance();
    const rect=$('.astra-stage').getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    volumeTarget.setSize(Math.max(1,Math.round(width*volumeScale)),Math.max(1,Math.round(height*volumeScale)));
    volumeDirty=true;labelSizesDirty=true;
    const fitRatio=fitDistance()/oldFit;
    targetDistance*=fitRatio;distance*=fitRatio;
    if(transition)transition.initialDistance*=fitRatio;
    wake();
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe($('.astra-stage'));resize();
  targetDistance=distance=fitDistance();
  const intersectionObserver=new IntersectionObserver(entries=>{isVisible=entries[0].isIntersecting;if(isVisible)wake();else if(frameRequest){cancelAnimationFrame(frameRequest);frameRequest=0;}});intersectionObserver.observe(root);
  listen(document,'visibilitychange',()=>{if(document.hidden){if(frameRequest)cancelAnimationFrame(frameRequest);frameRequest=0;}else wake();});
  function retheme(){
    readPalette();renderer.setClearColor(palette.space);
    themedMaterials.forEach(({material,key})=>material.color.copy(palette[key]));
    const array=stars.geometry.attributes.aColor.array;
    for(let i=0;i<STAR_COUNT;i++){const c=palette[['gold','ice','space-ink'][starKeys[i]]];array[i*3]=c.r*starBrightness[i];array[i*3+1]=c.g*starBrightness[i];array[i*3+2]=c.b*starBrightness[i];}
    stars.geometry.attributes.aColor.needsUpdate=true;
    const bg=background.geometry.attributes.aColor.array;
    backgroundKeys.forEach((key,i)=>{const c=palette[key],b=backgroundBrightness[i];bg[i*3]=c.r*b;bg[i*3+1]=c.g*b;bg[i*3+2]=c.b*b;});background.geometry.attributes.aColor.needsUpdate=true;
    volumeMaterial.uniforms.uWarm.value=palette.gold;volumeMaterial.uniforms.uCool.value=palette.ice;volumeMaterial.uniforms.uEmission.value=palette.emission;
    if(view==='system'){
      starSurface.material.uniforms.uBase.value=palette[systems[systemIndex].color];starSurface.userData.coronaMaterial.color.copy(palette[systems[systemIndex].color]);
      planetObjects.forEach(p=>{p.mesh.material.uniforms.uBase.value=palette[p.color];p.mesh.material.uniforms.uLight.value=palette['space-ink'];if(p.ringMesh){p.ringMesh.material.color.copy(palette[p.color]);p.outerRing.material.color.copy(palette[p.color]);}});
      currentOrbits.children.forEach(line=>line.material.color.copy(palette.orbit));selectionRing.material.color.copy(palette.gold);
    }
    volumeDirty=true;labelSizesDirty=true;wake();
  }
  const themeObserver=new MutationObserver(retheme);themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
  listen(matchMedia('(prefers-color-scheme: dark)'),'change',retheme);
  for(const type of ['click','input','change','pointerdown','pointermove','pointerup','pointercancel','wheel'])listen(root,type,event=>{if(type==='pointermove'&&!pointers.size)return;wake();},{passive:true});
  if(document.fonts)document.fonts.ready.then(()=>{if(!disposed){labelSizesDirty=true;wake();}});
  const lifecycleObserver=new MutationObserver(()=>{if(!root.isConnected)dispose();});lifecycleObserver.observe(root.parentNode,{childList:true});
  function dispose(){
    if(disposed)return;disposed=true;if(frameRequest)cancelAnimationFrame(frameRequest);frameRequest=0;
    eventController.abort();resizeObserver.disconnect();intersectionObserver.disconnect();themeObserver.disconnect();lifecycleObserver.disconnect();
    const geometries=new Set(),materials=new Set();
    [galaxyScene,systemScene,volumeScene].forEach(scene=>scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));}));
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());glowMap.dispose();densityTarget.dispose();volumeTarget.dispose();renderer.dispose();
  }
  let lastFrame=0,lastVolumeTime=-1,frameSamples=0,slowFrames=0;
  const lastVolumeEye=new THREE.Vector3(Infinity,Infinity,Infinity),lastVolumeRotation=new THREE.Quaternion();
  function render(now){
    frameRequest=0;
    if(disposed)return;
    if(!root.isConnected){dispose();return;}
    if(!isVisible||document.hidden)return;
    // Cap continuous animation at 30 fps. A paused, settled camera schedules no animation frames.
    if(!dirty&&now-lastFrame<30){frameRequest=requestAnimationFrame(render);return;}
    const elapsedSeconds=Math.max(0,(now-lastTime)/1000),dt=Math.min(elapsedSeconds,.05);lastTime=now;
    if(playing&&!dirty&&lastFrame>0){frameSamples++;if(now-lastFrame>44)slowFrames++;}
    lastFrame=now;
    if(playing){galaxyTime+=elapsedSeconds*3*timeMultiplier;systemTime+=elapsedSeconds*.12*timeMultiplier;}
    const ease=reducedMotion.matches?1:1-Math.exp(-dt*7);
    if(playing&&!reducedMotion.matches&&now-lastCameraInput>10000&&!transition)targetAzimuth+=dt*.009;
    if(transition){
      const t=Math.min(1,(now-transition.start)/720),k=t*t*(3-2*t);
      cameraTarget.copy(transition.initialTarget).lerp(markers[transition.index].position,k);
      distance=THREE.MathUtils.lerp(transition.initialDistance,2.5,k);
      if(t>=1){const next=transition.index;transition=null;enterSystem(next);}
    }else distance=THREE.MathUtils.lerp(distance,targetDistance,ease);
    azimuth=THREE.MathUtils.lerp(azimuth,targetAzimuth,ease);polar=THREE.MathUtils.lerp(polar,targetPolar,ease);
    camera.position.set(distance*Math.sin(polar)*Math.cos(azimuth),distance*Math.cos(polar),distance*Math.sin(polar)*Math.sin(azimuth)).add(cameraTarget);
    camera.lookAt(cameraTarget);camera.updateMatrixWorld();
    if(view==='galaxy')updateGalaxy();else updateSystem();
    if(view==='galaxy'&&(volumeDirty||lastVolumeTime!==galaxyTime||lastVolumeEye.distanceToSquared(camera.position)>1e-10||Math.abs(lastVolumeRotation.dot(camera.quaternion))<1-1e-11)){
      drawVolume();lastVolumeTime=galaxyTime;lastVolumeEye.copy(camera.position);lastVolumeRotation.copy(camera.quaternion);
    }
    renderer.render(view==='galaxy'?galaxyScene:systemScene,camera);
    if(dirty||labelSizesDirty||now-lastLabels>65||now-lastCameraInput<150){updateLabels();lastLabels=now;}
    if(dirty||now-lastReadout>140){
      const elapsed=view==='galaxy'?galaxyTime:systemTime;
      clockDisplay.textContent=elapsed.toFixed(view==='galaxy'?1:2)+(view==='galaxy'?' Myr':' yr');
      if(view==='system'&&selectedPlanet>=0){const p=planetObjects[selectedPlanet],r=p.position.length(),v=Math.sqrt(G_AU*systems[systemIndex].mass*(2/r-1/p.a))*AU_YR_TO_KM_S;clockDisplay.textContent+=' · '+r.toFixed(2)+' AU · '+v.toFixed(1)+' km/s';}
      lastReadout=now;
    }
    // Sustained slow frames reduce only diffuse-layer resolution; star count and orbital physics stay intact.
    if(frameSamples>=60){
      if(slowFrames>22&&volumeScale>.39){volumeScale=Math.max(.38,volumeScale-.09);volumeTarget.setSize(Math.round(width*volumeScale),Math.round(height*volumeScale));volumeDirty=true;}
      frameSamples=0;slowFrames=0;
    }
    dirty=false;
    const cameraMoving=Math.abs(distance-targetDistance)>1e-5||Math.abs(azimuth-targetAzimuth)>1e-6||Math.abs(polar-targetPolar)>1e-6;
    if(playing||transition||cameraMoving||(view==='galaxy'&&volumeDirty))frameRequest=requestAnimationFrame(render);
  }
  syncPlay();updateGalaxy();updateRate();loading.hidden=true;wake();
  listen(canvas,'webglcontextlost',event=>{event.preventDefault();playing=false;syncPlay();loading.hidden=false;loading.textContent='The 3D context was interrupted. Reopen this visualization to continue.';loading.setAttribute('role','alert');dispose();});
} catch(error) {
  loading.textContent='The 3D renderer could not start. Use the local server and a browser with WebGL 2 enabled.';
  loading.setAttribute('role','alert');
  $('[data-play]').disabled=true;
  console.error('Astra renderer:',error);
}
