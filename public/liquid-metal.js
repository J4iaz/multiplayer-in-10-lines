/**
 * Liquid Metal Buttons — Pure Vanilla JS & WebGL Shader
 * Supports:
 * - viewMode: 'text' (e.g. "+ Note", "Invite")
 * - viewMode: 'icon' (e.g. Sparkles, Refresh)
 * - 3D depth layers (Z: 0px, 10px, 20px, 25px)
 * - Animated liquid chrome fragment shader canvas
 * - Multi-ripple click animations
 */
(function (global) {
  'use strict';

  var SHADER_VERTEX = [
    'attribute vec2 position;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = position * 0.5 + 0.5;',
    '  gl_Position = vec4(position, 0.0, 1.0);',
    '}'
  ].join('\n');

  var SHADER_FRAGMENT = [
    'precision highp float;',
    'uniform float u_time;',
    'uniform vec2 u_resolution;',
    'uniform float u_speed;',
    'varying vec2 vUv;',
    '',
    'void main() {',
    '  vec2 p = (vUv - 0.5) * 2.0;',
    '  float aspect = u_resolution.x / max(u_resolution.y, 1.0);',
    '  p.x *= min(aspect, 4.0);',
    '',
    '  float t = u_time * u_speed * 1.5;',
    '  float v1 = sin(p.x * 4.0 + t) + cos(p.y * 4.0 - t * 0.8);',
    '  float v2 = sin(p.x * 2.5 - p.y * 2.5 + t * 1.2);',
    '  float v3 = sin(length(p) * 6.0 - t * 1.5);',
    '  float flow = (v1 + v2 + v3) * 0.333;',
    '',
    '  // Chrome specular calculation',
    '  vec3 chrome = vec3(0.55) + vec3(0.45) * cos(6.28318 * (vec3(flow) + vec3(0.0, 0.08, 0.18)));',
    '  float specular = pow(max(0.0, sin(flow * 3.1415 + t)), 8.0) * 0.6;',
    '  chrome += vec3(specular);',
    '',
    '  // Metallic sheen tint (liquid mercury / platinum)',
    '  vec3 col = mix(vec3(0.12, 0.16, 0.22), chrome, 0.85);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compileShader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  function initShaderCanvas(canvas) {
    if (!canvas) return null;
    var gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;

    var prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, SHADER_VERTEX));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, SHADER_FRAGMENT));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    var pos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    var uTime = gl.getUniformLocation(prog, 'u_time');
    var uRes = gl.getUniformLocation(prog, 'u_resolution');
    var uSpeed = gl.getUniformLocation(prog, 'u_speed');

    var currentSpeed = 0.6;
    var targetSpeed = 0.6;
    var elapsed = 0;
    var last = performance.now();
    var frameId = null;

    function resize() {
      var dpr = Math.min(global.devicePixelRatio || 1, 1.5);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    function render(now) {
      var dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      currentSpeed += (targetSpeed - currentSpeed) * 0.15;
      elapsed += dt * currentSpeed;

      resize();
      gl.uniform1f(uTime, elapsed);
      gl.uniform1f(uSpeed, 1.0);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      frameId = requestAnimationFrame(render);
    }
    frameId = requestAnimationFrame(render);

    return {
      setSpeed: function (s) {
        targetSpeed = s;
      },
      destroy: function () {
        if (frameId) cancelAnimationFrame(frameId);
      }
    };
  }

  function setupLiquidMetalButton(btnEl) {
    if (btnEl.dataset.liquidMetalReady) return;
    btnEl.dataset.liquidMetalReady = 'true';

    var canvas = btnEl.querySelector('.lmb-shader-canvas');
    var shader = initShaderCanvas(canvas);

    var actionBtn = btnEl.querySelector('.lmb-hitbox');
    if (!actionBtn) return;

    btnEl.addEventListener('mouseenter', function () {
      btnEl.classList.add('is-hovered');
      if (shader) shader.setSpeed(1.2);
    });

    btnEl.addEventListener('mouseleave', function () {
      btnEl.classList.remove('is-hovered', 'is-pressed');
      if (shader) shader.setSpeed(0.6);
    });

    actionBtn.addEventListener('mousedown', function () {
      btnEl.classList.add('is-pressed');
    });

    actionBtn.addEventListener('mouseup', function () {
      btnEl.classList.remove('is-pressed');
    });

    actionBtn.addEventListener('click', function (e) {
      if (shader) {
        shader.setSpeed(2.8);
        setTimeout(function () {
          shader.setSpeed(btnEl.classList.contains('is-hovered') ? 1.2 : 0.6);
        }, 320);
      }

      // Ripple effect
      var rect = actionBtn.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;

      var ripple = document.createElement('span');
      ripple.className = 'lmb-ripple';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      actionBtn.appendChild(ripple);

      setTimeout(function () {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      }, 600);
    });
  }

  function initTopbarLiquidMetal() {
    var canvas = document.getElementById('topbarShaderCanvas');
    if (!canvas || canvas.dataset.metalReady) return;
    canvas.dataset.metalReady = 'true';

    var shader = initShaderCanvas(canvas);
    var shell = document.querySelector('.topbar-shell');
    if (!shell || !shader) return;

    shell.addEventListener('mouseenter', function () {
      shader.setSpeed(1.2);
    });

    shell.addEventListener('mouseleave', function () {
      shader.setSpeed(0.6);
    });

    shell.addEventListener('click', function () {
      shader.setSpeed(2.4);
      setTimeout(function () {
        shader.setSpeed(shell.matches(':hover') ? 1.2 : 0.6);
      }, 350);
    });
  }

  function initAll() {
    initTopbarLiquidMetal();
    var buttons = document.querySelectorAll('.liquid-metal-wrapper');
    for (var i = 0; i < buttons.length; i++) {
      setupLiquidMetalButton(buttons[i]);
    }
  }

  global.initLiquidMetal = initAll;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})(typeof window !== 'undefined' ? window : this);
