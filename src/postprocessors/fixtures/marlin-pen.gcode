; image-to-gcode - inspect before running
; mode: contour
; post-processor: Marlin Pen Plotter
G17
G21
G90
UP
G21
G90
G0 X1 Y1 F200
DOWN
G21
G90
G1 X3 Y3 F100
UP
M2
