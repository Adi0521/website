uniform float uTime, uSeaLevel, uShoreZ, uSlope;
uniform float uWaveAmp, uWaveLen, uWavePhase, uSurge;
uniform float uSwash, uSwashFilm, uSwashLat;

// the beach itself: a gentle ramp, zero at the shoreline, rising toward the
// camera and dropping away seaward
float beachY(float z){ return clamp((z - uShoreZ)*uSlope, -1.3, 0.9); }

// how far along the beach we are, laterally. two sines drifting at different
// rates and in opposite directions, so the pattern never repeats within a
// wave and successive waves do not arrive with the same shape. one sine alone
// is too regular — it reads as a ripple stamped along the waterline.
// normalised to about ±1 (the two amplitudes sum to 1.55) so uSwashLat reads
// as a straight fraction of the reach, and so a sane value cannot drive the
// modulation below zero and invert the swash into a wave that sucks backwards.
float lateral(vec2 xz){
  return (sin(xz.x*0.8 + uTime*0.23) + 0.55*sin(xz.x*1.93 - uTime*0.17 + 2.1))*0.645;
}

// travelling swell. the shoaling taper is essential: without it the swell
// keeps oscillating over dry sand and spawns standing bands of water up the
// beach that blink in and out instead of a sheet running up and draining.
// phase is accumulated on the cpu so wave speed can drift without the whole
// train jumping backwards.
float swellWith(vec2 xz, float lat){
  float ph = xz.y*(6.28318/max(uWaveLen,0.05)) - uWavePhase;
  float w  = sin(ph)*0.55 + sin(ph*1.87 + 1.3)*0.28 + sin(ph*0.61 - 2.1)*0.30;
  w += lat*0.18;   // matches the prototype's lateral swell amplitude
  float stillDepth = uSeaLevel - beachY(xz.y);
  return w*uWaveAmp*smoothstep(0.0, 0.15, stillDepth);
}

// uSwash / uSwashFilm come from the cpu-side wave scheduler. they are scalars
// because the scheduler's per-wave randomisation is a chain of hashes, and
// evaluating that per ray-march step would cost thousands of hashes a pixel
// for a value constant across the frame.
//
// but a scalar swash means the sheet arrives as one dead-straight line across
// the entire beach, every wave identical along its length. uSwashLat bends the
// reach with the same cheap lateral function the swell already uses — a
// smooth sine, not a hash, so the per-step cost is one extra sin and the
// scheduler stays on the cpu where it belongs.
float waterY(vec2 xz){
  float lat = lateral(xz);
  return uSeaLevel + swellWith(xz, lat) + uSwash*uSurge*(1.0 + uSwashLat*lat);
}
float filmY (vec2 xz){
  float lat = lateral(xz);
  return uSeaLevel + swellWith(xz, lat) + uSwashFilm*uSurge*(1.0 + uSwashLat*lat);
}