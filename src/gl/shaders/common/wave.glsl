uniform float uTime, uSeaLevel, uShoreZ, uSlope;
uniform float uWaveAmp, uWaveLen, uWavePhase, uSurge;
uniform float uSwash, uSwashFilm;

// the beach itself: a gentle ramp, zero at the shoreline, rising toward the
// camera and dropping away seaward
float beachY(float z){ return clamp((z - uShoreZ)*uSlope, -1.3, 0.9); }

// travelling swell. the shoaling taper is essential: without it the swell
// keeps oscillating over dry sand and spawns standing bands of water up the
// beach that blink in and out instead of a sheet running up and draining.
// phase is accumulated on the cpu so wave speed can drift without the whole
// train jumping backwards.
float swellAt(vec2 xz){
  float ph = xz.y*(6.28318/max(uWaveLen,0.05)) - uWavePhase;
  float w  = sin(ph)*0.55 + sin(ph*1.87 + 1.3)*0.28 + sin(ph*0.61 - 2.1)*0.30;
  w += sin(xz.x*0.8 + uTime*0.23)*0.18;
  float stillDepth = uSeaLevel - beachY(xz.y);
  return w*uWaveAmp*smoothstep(0.0, 0.15, stillDepth);
}

// uSwash / uSwashFilm come from the cpu-side wave scheduler. they vary only
// with time, so evaluating them per ray-march step would cost thousands of
// hashes a pixel for a value that is constant across the frame.
float waterY(vec2 xz){ return uSeaLevel + swellAt(xz) + uSwash*uSurge; }
float filmY (vec2 xz){ return uSeaLevel + swellAt(xz) + uSwashFilm*uSurge; }