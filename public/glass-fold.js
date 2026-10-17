/**
 * GlassFold — Pure Vanilla WebGL Canvas Implementation
 * From GradFlow: Animated WebGL glass-fold gradient background.
 */
(function (global) {
  'use strict';

  var VERTEX = [
    'attribute vec2 position;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = position * 0.5 + 0.5;',
    '  gl_Position = vec4(position, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAGMENT = [
    'precision highp float;',
    'uniform float u_time;',
    'uniform vec3 u_color1;',
    'uniform vec3 u_color2;',
    'uniform vec3 u_color3;',
    'uniform float u_scale;',
    'uniform float u_noise;',
    'uniform vec2 u_resolution;',
    'varying vec2 vUv;',
    '',
    'float grain(vec2 st) {',
    '  return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453);',
    '}',
    '',
    'vec2 centered(vec2 uv) {',
    '  vec2 p = uv - 0.5;',
    '  p.x *= u_resolution.x / max(u_resolution.y, 1.0);',
    '  return p;',
    '}',
    '',
    'mat2 rot(float a) {',
    '  float s = sin(a);',
    '  float c = cos(a);',
    '  return mat2(c, -s, s, c);',
    '}',
    '',
    'vec3 shade(vec2 uv, float time) {',
    '  vec2 q = rot(0.6) * centered(uv) * 2.0 * u_scale;',
    '  float t = time * 0.6;',
    '  float pixel = 2.0 * u_scale / max(u_resolution.y, 1.0);',
    '  vec3 color = mix(u_color2, u_color2 * 0.45, clamp(length(centered(uv)) * 1.3, 0.0, 1.0));',
    '  for (int i = 0; i < 6; i++) {',
    '    float fi = float(i);',
    '    float bend = mod(fi, 2.0) * 2.0 - 1.0;',
    '    float crease = (fi - 2.5) * 0.4',
    '                 + 0.26 * sin(q.x * (1.05 + 0.12 * fi) + fi * 1.9 + t * (0.25 + 0.05 * fi))',
    '                 + 0.1 * bend * q.x * q.x;',
    '    float s = q.y - crease;',
    '    float pane = smoothstep(-pixel, pixel, s);',
    '    float back = max(s, 0.0);',
    '    float body = exp(-back * 1.7);',
    '    float fresnel = exp(-back * 8.0);',
    '    float rim = exp(-back * 80.0);',
    '    float inner = exp(-pow((back - 0.045) / 0.014, 2.0));',
    '    float bloom = exp(-abs(s) * 20.0);',
    '    vec3 tint = mix(u_color1, u_color3, clamp(fresnel * 0.6 + 0.08 + 0.14 * sin(fi * 2.1 + q.x * 0.8 + t * 0.2), 0.0, 1.0));',
    '    vec3 light = tint * pane * (body * 0.42 + fresnel * 0.4)',
    '               + u_color3 * (pane * (rim * 0.6 + inner * 0.12) + bloom * 0.1);',
    '    color += light * (1.0 - color);',
    '  }',
    '  return clamp(color, 0.0, 1.0);',
    '}',
    '',
    'void main() {',
    '  vec3 color = shade(vUv, u_time);',
    '  if (u_noise > 0.001) {',
    '    float g = grain(vUv * 200.0 + u_time * 0.1);',
    '    color *= 1.0 - u_noise * 0.4 + u_noise * g * 0.4;',
    '  }',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  function hexToVec3(hex) {
    var h = hex.replace('#', '');
    var full = h.length === 3 ? h.split('').map(function (c) { return c + c; }).join('') : h;
    var n = parseInt(full, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  function initGlassFold(canvas, opts) {
    if (!canvas) return null;
    try {
      var config = Object.assign({
        color1: '#1e3cc8',
        color2: '#06081e',
        color3: '#96d7ff',
        speed: 0.5,
        scale: 1,
        noise: 0.12
      }, opts || {});

      var gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl) return null;

      var program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      gl.useProgram(program);

      var buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      var position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      var u = {
        time: gl.getUniformLocation(program, 'u_time'),
        color1: gl.getUniformLocation(program, 'u_color1'),
        color2: gl.getUniformLocation(program, 'u_color2'),
        color3: gl.getUniformLocation(program, 'u_color3'),
        scale: gl.getUniformLocation(program, 'u_scale'),
        noise: gl.getUniformLocation(program, 'u_noise'),
        resolution: gl.getUniformLocation(program, 'u_resolution')
      };

      var c1 = hexToVec3(config.color1);
      var c2 = hexToVec3(config.color2);
      var c3 = hexToVec3(config.color3);

      function resize() {
        var dpr = Math.min(global.devicePixelRatio || 1, 1.5);
        var width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        var height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        gl.viewport(0, 0, width, height);
      }

      var elapsed = 0;
      var last = null;
      var frame = null;
      var still = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

      function draw(now) {
        if (last !== null) {
          elapsed += Math.min((now - last) / 1000, 0.1) * config.speed;
        }
        last = now;

        resize();
        gl.uniform1f(u.time, elapsed);
        gl.uniform3fv(u.color1, c1);
        gl.uniform3fv(u.color2, c2);
        gl.uniform3fv(u.color3, c3);
        gl.uniform1f(u.scale, config.scale);
        gl.uniform1f(u.noise, config.noise);
        gl.uniform2f(u.resolution, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      function loop(now) {
        draw(now);
        if (!still) frame = requestAnimationFrame(loop);
      }
      frame = requestAnimationFrame(loop);

      var observer = new ResizeObserver(function () {
        if (still) draw(performance.now());
      });
      observer.observe(canvas);

      return {
        destroy: function () {
          if (frame) cancelAnimationFrame(frame);
          observer.disconnect();
          try {
            gl.deleteBuffer(buffer);
            gl.deleteProgram(program);
          } catch (e) {}
        }
      };
    } catch (e) {
      console.warn('[glass-fold] WebGL initialization skipped:', e);
      return null;
    }
  }

  global.initGlassFold = initGlassFold;

  function autoInit() {
    var canvas = global.document && global.document.getElementById('glassFoldCanvas');
    if (canvas) {
      initGlassFold(canvas, {
        color1: '#1e3cc8',
        color2: '#06081e',
        color3: '#96d7ff',
        speed: 0.5,
        scale: 1.0,
        noise: 0.12
      });
    }
  }

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', autoInit);
    } else {
      autoInit();
    }
  }
})(typeof window !== 'undefined' ? window : this);

