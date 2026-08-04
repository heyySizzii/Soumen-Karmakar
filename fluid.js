/* ════════════════════════════════════════════════════════════
   WEBGL FLUID SIMULATION
   Real-time Navier–Stokes based fluid solver rendered on a
   full-viewport transparent canvas. Reacts to mouse movement
   and touch, painted with a rotating pastel palette (neon lime,
   magenta/pink, cyan, purple, yellow). Purely additive layer —
   does not touch any existing markup/behaviour.
   ════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  var canvas = document.getElementById('fluid-canvas');
  if (!canvas) return;

  var config = {
    SIM_RESOLUTION: 64,
    DYE_RESOLUTION: 360,
    DENSITY_DISSIPATION: 2.0,
    VELOCITY_DISSIPATION: 1.6,
    PRESSURE: 0.8,
    PRESSURE_ITERATIONS: 12,
    CURL: 20,
    SPLAT_RADIUS: 0.22,
    SPLAT_FORCE: 5500,
    SHADING: true
  };

  // ── Pastel palette requested: lime green, magenta/pink, cyan, purple, yellow
  var PALETTE = [
    [0.62, 1.00, 0.30], // neon lime green
    [1.00, 0.25, 0.85], // magenta / pink
    [0.25, 0.95, 1.00], // cyan
    [0.65, 0.30, 1.00], // purple
    [1.00, 0.92, 0.30]  // yellow
  ];
  var paletteIdx = 0;
  function nextColor(){
    var c = PALETTE[paletteIdx % PALETTE.length];
    paletteIdx++;
    // soften towards pastel + randomize slightly so it never looks flat
    var jitter = function(v){ return Math.min(1, Math.max(0, v * (0.85 + Math.random() * 0.3))); };
    return { r: jitter(c[0]), g: jitter(c[1]), b: jitter(c[2]) };
  }

  // ── WebGL context (with graceful fallback if unavailable) ──
  var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
  var gl = canvas.getContext('webgl2', params);
  var isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
  if (!gl) { canvas.style.display = 'none'; return; }

  var halfFloat, supportLinearFiltering;
  if (isWebGL2){
    gl.getExtension('EXT_color_buffer_float');
    supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
  } else {
    halfFloat = gl.getExtension('OES_texture_half_float');
    supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
  }
  gl.clearColor(0.0, 0.0, 0.0, 0.0);

  var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : (halfFloat && halfFloat.HALF_FLOAT_OES);
  var formatRGBA, formatRG, formatR;

  function getSupportedFormat(gl, internalFormat, format, type){
    if (!supportRenderTextureFormat(gl, internalFormat, format, type)){
      if (isWebGL2){
        switch (internalFormat){
          case gl.R16F: return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
          case gl.RG16F: return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
          default: return null;
        }
      }
      return null;
    }
    return { internalFormat: internalFormat, format: format };
  }
  function supportRenderTextureFormat(gl, internalFormat, format, type){
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    return status === gl.FRAMEBUFFER_COMPLETE;
  }

  if (isWebGL2){
    formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
    formatRG   = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
    formatR    = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
  } else {
    formatRGBA = { internalFormat: gl.RGBA, format: gl.RGBA };
    formatRG   = { internalFormat: gl.RGBA, format: gl.RGBA };
    formatR    = { internalFormat: gl.RGBA, format: gl.RGBA };
  }
  // Ultimate fallback: if float textures aren't supported at all, bail out quietly.
  if (!formatRGBA){ canvas.style.display = 'none'; return; }

  // ────────────────────────────────────────────────────────────
  //  Shader helpers
  // ────────────────────────────────────────────────────────────
  function compileShader(type, source){
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
      console.error('[fluid] shader error:', gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  function createProgram(vertexShader, fragmentSource){
    var fs = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)){
      console.error('[fluid] program link error:', gl.getProgramInfoLog(program));
    }
    var uniforms = {};
    var uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < uniformCount; i++){
      var name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program: program, uniforms: uniforms };
  }

  var baseVertexShader = compileShader(gl.VERTEX_SHADER, [
    'precision highp float;',
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform vec2 texelSize;',
    'void main () {',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  vL = vUv - vec2(texelSize.x, 0.0);',
    '  vR = vUv + vec2(texelSize.x, 0.0);',
    '  vT = vUv + vec2(0.0, texelSize.y);',
    '  vB = vUv - vec2(0.0, texelSize.y);',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n'));

  function frag(src){ return 'precision highp float;precision mediump sampler2D;\n' + src; }

  var copyShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv;',
    'uniform sampler2D uTexture;',
    'void main () { gl_FragColor = texture2D(uTexture, vUv); }'
  ].join('\n')));

  var clearShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv;',
    'uniform sampler2D uTexture;',
    'uniform float value;',
    'void main () { gl_FragColor = value * texture2D(uTexture, vUv); }'
  ].join('\n')));

  var splatShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv;',
    'uniform sampler2D uTarget;',
    'uniform float aspectRatio;',
    'uniform vec3 color;',
    'uniform vec2 point;',
    'uniform float radius;',
    'void main () {',
    '  vec2 p = vUv - point.xy;',
    '  p.x *= aspectRatio;',
    '  vec3 splat = exp(-dot(p, p) / radius) * color;',
    '  vec3 base = texture2D(uTarget, vUv).xyz;',
    '  gl_FragColor = vec4(base + splat, 1.0);',
    '}'
  ].join('\n')));

  var advectionShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uSource;',
    'uniform vec2 texelSize;',
    'uniform float dt;',
    'uniform float dissipation;',
    'void main () {',
    '  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;',
    '  vec4 result = texture2D(uSource, coord);',
    '  float decay = 1.0 + dissipation * dt;',
    '  gl_FragColor = result / decay;',
    '}'
  ].join('\n')));

  var divergenceShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uVelocity, vL).x;',
    '  float R = texture2D(uVelocity, vR).x;',
    '  float T = texture2D(uVelocity, vT).y;',
    '  float B = texture2D(uVelocity, vB).y;',
    '  vec2 C = texture2D(uVelocity, vUv).xy;',
    '  if (vL.x < 0.0) { L = -C.x; }',
    '  if (vR.x > 1.0) { R = -C.x; }',
    '  if (vT.y > 1.0) { T = -C.y; }',
    '  if (vB.y < 0.0) { B = -C.y; }',
    '  float div = 0.5 * (R - L + T - B);',
    '  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n')));

  var curlShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uVelocity, vL).y;',
    '  float R = texture2D(uVelocity, vR).y;',
    '  float T = texture2D(uVelocity, vT).x;',
    '  float B = texture2D(uVelocity, vB).x;',
    '  float vorticity = R - L - T + B;',
    '  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n')));

  var vorticityShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uCurl;',
    'uniform float curl;',
    'uniform float dt;',
    'void main () {',
    '  float L = texture2D(uCurl, vL).x;',
    '  float R = texture2D(uCurl, vR).x;',
    '  float T = texture2D(uCurl, vT).x;',
    '  float B = texture2D(uCurl, vB).x;',
    '  float C = texture2D(uCurl, vUv).x;',
    '  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));',
    '  force /= length(force) + 0.0001;',
    '  force *= curl * C;',
    '  force.y *= -1.0;',
    '  vec2 vel = texture2D(uVelocity, vUv).xy;',
    '  gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);',
    '}'
  ].join('\n')));

  var pressureShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform sampler2D uPressure;',
    'uniform sampler2D uDivergence;',
    'void main () {',
    '  float L = texture2D(uPressure, vL).x;',
    '  float R = texture2D(uPressure, vR).x;',
    '  float T = texture2D(uPressure, vT).x;',
    '  float B = texture2D(uPressure, vB).x;',
    '  float divergence = texture2D(uDivergence, vUv).x;',
    '  float pressure = (L + R + B + T - divergence) * 0.25;',
    '  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n')));

  var gradientSubtractShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;',
    'uniform sampler2D uPressure;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '  float L = texture2D(uPressure, vL).x;',
    '  float R = texture2D(uPressure, vR).x;',
    '  float T = texture2D(uPressure, vT).x;',
    '  float B = texture2D(uPressure, vB).x;',
    '  vec2 vel = texture2D(uVelocity, vUv).xy;',
    '  vel -= vec2(R - L, T - B);',
    '  gl_FragColor = vec4(vel, 0.0, 1.0);',
    '}'
  ].join('\n')));

  var displayShader = createProgram(baseVertexShader, frag([
    'varying vec2 vUv;',
    'uniform sampler2D uTexture;',
    'void main () {',
    '  vec3 c = texture2D(uTexture, vUv).rgb;',
    '  float a = clamp(max(max(c.r, c.g), c.b), 0.0, 1.0);',
    '  gl_FragColor = vec4(c, a);',
    '}'
  ].join('\n')));

  // ────────────────────────────────────────────────────────────
  //  Fullscreen quad + framebuffer helpers
  // ────────────────────────────────────────────────────────────
  var quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  var elemBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elemBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function blit(target){
    if (target == null){
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  function createFBO(w, h, internalFormat, format, type, param){
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      texture: texture, fbo: fbo, width: w, height: h,
      attach: function(id){ gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; }
    };
  }

  function createDoubleFBO(w, h, internalFormat, format, type, param){
    var fbo1 = createFBO(w, h, internalFormat, format, type, param);
    var fbo2 = createFBO(w, h, internalFormat, format, type, param);
    return {
      width: w, height: h,
      get read(){ return fbo1; }, set read(v){ fbo1 = v; },
      get write(){ return fbo2; }, set write(v){ fbo2 = v; },
      swap: function(){ var tmp = fbo1; fbo1 = fbo2; fbo2 = tmp; }
    };
  }

  function getResolution(resolution){
    var aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
    var min = Math.round(resolution);
    var max = Math.round(resolution * aspectRatio);
    if (gl.drawingBufferWidth > gl.drawingBufferHeight) return { width: max, height: min };
    return { width: min, height: max };
  }

  var filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
  var dye, velocity, divergence, curl, pressure;

  function initFramebuffers(){
    var simRes = getResolution(config.SIM_RESOLUTION);
    var dyeRes = getResolution(config.DYE_RESOLUTION);
    var texType = halfFloatTexType;
    var rgba = formatRGBA, rg = formatRG, r = formatR;

    dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
  }

  function cappedDPR(){ return Math.min(window.devicePixelRatio || 1, 1.5); }

  function resizeCanvas(){
    var w = Math.max(1, Math.floor(canvas.clientWidth * cappedDPR()));
    var h = Math.max(1, Math.floor(canvas.clientHeight * cappedDPR()));
    if (canvas.width !== w || canvas.height !== h){
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  resizeCanvas();
  initFramebuffers();

  window.addEventListener('resize', function(){
    if (resizeCanvas()) initFramebuffers();
  });
  window.addEventListener('orientationchange', function(){
    setTimeout(function(){ if (resizeCanvas()) initFramebuffers(); }, 60);
  });

  // ────────────────────────────────────────────────────────────
  //  Pointer / touch tracking  (mouse + multi-touch)
  // ────────────────────────────────────────────────────────────
  function makePointer(){
    return { id: -1, x: 0, y: 0, dx: 0, dy: 0, down: false, moved: false, color: nextColor() };
  }
  var pointers = [makePointer()];

  function scaleByPixelRatio(input){ return Math.floor(input * cappedDPR()); }

    function updatePointerMove(p, x, y){
    p.moved = true; // Ensures the trail paints as long as cursor moves
    p.down = true;  
    p.color = nextColor(); // Continuously cycles colors like in the video!
    var prevX = p.x, prevY = p.y;
    p.x = x; p.y = y;
    p.dx = (x - prevX) * 6.0;
    p.dy = (y - prevY) * 6.0;
  }


  function vibrateOnMobile(){
    // "Haptics" feedback for touch interaction where supported (Android Chrome).
    if (navigator.vibrate){
      try { navigator.vibrate(8); } catch (e) {}
    }
  }

  window.addEventListener('mousemove', function(e){
    var p = pointers[0];
    var x = scaleByPixelRatio(e.clientX);
    var y = scaleByPixelRatio(e.clientY);
    p.down = true;
    updatePointerMove(p, x, y);
  }, { passive: true });

  window.addEventListener('mousedown', function(e){
    var p = pointers[0];
    p.down = true;
    p.color = nextColor();
    p.x = scaleByPixelRatio(e.clientX);
    p.y = scaleByPixelRatio(e.clientY);
  }, { passive: true });

  window.addEventListener('touchstart', function(e){
    var touches = e.targetTouches;
    for (var i = 0; i < touches.length; i++){
      var t = touches[i];
      var p = pointers[i + 1] || makePointer();
      pointers[i + 1] = p;
      p.id = t.identifier;
      p.down = true;
      p.color = nextColor();
      p.x = scaleByPixelRatio(t.clientX);
      p.y = scaleByPixelRatio(t.clientY);
    }
    vibrateOnMobile();
  }, { passive: true });

  window.addEventListener('touchmove', function(e){
    var touches = e.targetTouches;
    for (var i = 0; i < touches.length; i++){
      var t = touches[i];
      var p = pointers[i + 1];
      if (!p) continue;
      updatePointerMove(p, scaleByPixelRatio(t.clientX), scaleByPixelRatio(t.clientY));
    }
  }, { passive: true });

  function endTouches(e){
    var touches = e.changedTouches;
    for (var i = 0; i < touches.length; i++){
      for (var j = 1; j < pointers.length; j++){
        if (pointers[j] && pointers[j].id === touches[i].identifier) pointers[j].down = false;
      }
    }
  }
  window.addEventListener('touchend', endTouches, { passive: true });
  window.addEventListener('touchcancel', endTouches, { passive: true });

  // gentle idle motion so the fluid feels alive before the user moves the cursor
  var lastAutoSplat = 0;

  // ────────────────────────────────────────────────────────────
  //  Simulation step helpers
  // ────────────────────────────────────────────────────────────
  function useProgram(p){ gl.useProgram(p.program); return p; }

  function splat(x, y, dx, dy, color){
    useProgram(splatShader);
    gl.uniform1i(splatShader.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatShader.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatShader.uniforms.point, x, y);
    gl.uniform3f(splatShader.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(splatShader.uniforms.radius, config.SPLAT_RADIUS / 100.0);
    blit(velocity.write);
    velocity.swap();

    gl.uniform1i(splatShader.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatShader.uniforms.color, color.r, color.g, color.b);
    blit(dye.write);
    dye.swap();
  }

  function splatPointer(p){
    var dx = p.dx * config.SPLAT_FORCE / 1000;
    var dy = p.dy * config.SPLAT_FORCE / 1000;
    splat(p.x / canvas.width, 1.0 - p.y / canvas.height, dx, dy, p.color);
  }

  var lastTime = Date.now();
  function calcDt(){
    var now = Date.now();
    var dt = Math.min((now - lastTime) / 1000, 0.016666 * 2);
    lastTime = now;
    return dt;
  }

  function step(dt){
    gl.disable(gl.BLEND);

    useProgram(curlShader);
    gl.uniform2f(curlShader.uniforms.texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
    gl.uniform1i(curlShader.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl);

    useProgram(vorticityShader);
    gl.uniform2f(vorticityShader.uniforms.texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
    gl.uniform1i(vorticityShader.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityShader.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityShader.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityShader.uniforms.dt, dt);
    blit(velocity.write);
    velocity.swap();

    useProgram(divergenceShader);
    gl.uniform2f(divergenceShader.uniforms.texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
    gl.uniform1i(divergenceShader.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence);

    useProgram(clearShader);
    gl.uniform1i(clearShader.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearShader.uniforms.value, config.PRESSURE);
    blit(pressure.write);
    pressure.swap();

    useProgram(pressureShader);
    gl.uniform2f(pressureShader.uniforms.texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
    gl.uniform1i(pressureShader.uniforms.uDivergence, divergence.attach(0));
    for (var i = 0; i < config.PRESSURE_ITERATIONS; i++){
      gl.uniform1i(pressureShader.uniforms.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    useProgram(gradientSubtractShader);
    gl.uniform2f(gradientSubtractShader.uniforms.texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
    gl.uniform1i(gradientSubtractShader.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradientSubtractShader.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write);
    velocity.swap();

    useProgram(advectionShader);
    gl.uniform2f(advectionShader.uniforms.texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
    gl.uniform1i(advectionShader.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionShader.uniforms.uSource, velocity.read.attach(0));
    gl.uniform1f(advectionShader.uniforms.dt, dt);
    gl.uniform1f(advectionShader.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write);
    velocity.swap();

    gl.uniform2f(advectionShader.uniforms.texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
    gl.uniform1i(advectionShader.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionShader.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionShader.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write);
    dye.swap();
  }

  function render(){
    gl.disable(gl.BLEND);
    useProgram(displayShader);
    gl.uniform1i(displayShader.uniforms.uTexture, dye.read.attach(0));
    blit(null);
  }

  function update(){
    var dt = calcDt();
    if (resizeCanvas()) initFramebuffers();

    pointers.forEach(function(p){
      if (p.moved){
        p.moved = false;
        splatPointer(p);
      }
    });

    // subtle ambient drift so the canvas is never fully static/dead
    var now = performance.now();
    if (now - lastAutoSplat > 3500){
      lastAutoSplat = now;
      var ax = 0.5 + (Math.random() - 0.5) * 0.3;
      var ay = 0.5 + (Math.random() - 0.5) * 0.3;
      splat(ax, ay, (Math.random() - 0.5) * 400, (Math.random() - 0.5) * 400, nextColor());
    }

    step(dt);
    render();
    requestAnimationFrame(update);
  }

  var started = false;
  function startLoop(){
    if (started) return;
    started = true;
    lastTime = Date.now();
    requestAnimationFrame(update);
  }

  // The canvas is fully hidden behind the intro overlay while it plays, so
  // there is no point spending CPU/GPU cycles on the simulation until the
  // intro has actually finished. This also guarantees the intro's own
  // timing is never starved by fluid rendering work.
  if (document.body.classList.contains('intro-active')){
    window.addEventListener('introComplete', startLoop, { once: true });
    // Safety net in case intro.js is missing/blocked for any reason.
    setTimeout(startLoop, 7000);
  } else {
    startLoop();
  }

  // Pause the loop entirely when the tab isn't visible (saves battery/CPU).
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) startLoop();
  });

})();
