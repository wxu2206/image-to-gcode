; image-to-gcode - inspect before running
; mode: contour
; post-processor: Generic CNC
G17
G21
G90
G94
G0 Z5
G0 X1 Y1 Z5 F200
G1 X1 Y1 Z-1 F100
G1 X3 Y3 Z-1 F100
G0 Z5
M2
