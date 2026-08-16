; image-to-gcode - inspect before running
; mode: contour
; post-processor: GRBL Pen Plotter
G17
G21
G90
G94
UP
G21
G90
G94
G0 X1 Y1 F200
DOWN
G21
G90
G94
G1 X3 Y3 F100
UP
M2
