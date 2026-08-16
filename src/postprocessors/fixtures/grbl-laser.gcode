; image-to-gcode - inspect before running
; mode: contour
; post-processor: GRBL / FluidNC Laser
G17
G21
G90
G94
M5
G21
G90
G94
G0 X1 Y1 F200
M4 S100
G21
G90
G94
G1 X3 Y3 F100
M5
M2
