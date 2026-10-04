# BSP v2 cost=0.5 minrisk=0.3

barras=13730 signals=1208 trades=7026 invalid_stop=542

## (a) Top combos

 side       entry_mode    exit_model  n_signals  trades   net_R  avg_R  mediana_R  trim5   win%    PF  avg_bars  net_exTop5     %top5  net_winsor5  avg_winsor5
 LONG     RETEST_TOUCH       TP_2ATR      257.0   257.0  64.707  0.252     -1.036  0.107 34.241 1.330     3.992      33.637    48.017       62.141        0.242
SHORT     RETEST_TOUCH       TP_1ATR      281.0   281.0  36.998  0.132     -1.023  0.055 47.331 1.233     2.886      20.910    43.483       36.998        0.132
SHORT     RETEST_TOUCH       TP_2ATR      281.0   281.0  36.380  0.129     -1.041 -0.087 29.537 1.171     4.423       5.044    86.134       28.245        0.101
 LONG RETEST_CONFIRMED BE_THEN_TRAIL      294.0   294.0  31.814  0.108     -1.008 -0.143 47.619 1.196     9.568     -20.065   163.070        4.285        0.015
SHORT RETEST_CONFIRMED       TP_2ATR      311.0   311.0  19.226  0.062     -1.023 -0.082 37.942 1.095     5.765      -7.303   137.984       16.439        0.053
SHORT     RETEST_TOUCH     TIME_FAST      281.0   281.0  18.988  0.068     -1.052 -0.516 15.658 1.075     8.149     -67.209   453.961      -84.099       -0.299
 LONG     RETEST_TOUCH BE_THEN_TRAIL      257.0   257.0   8.336  0.032     -0.105 -0.235 45.136 1.068     3.922     -38.951   567.239      -15.582       -0.061
SHORT RETEST_CONFIRMED   SWING_TRAIL      311.0   311.0   8.322  0.027     -0.551 -0.240 27.331 1.050     7.080     -42.223   607.360      -18.781       -0.060
SHORT RETEST_CONFIRMED     TIME_FAST      311.0   311.0   6.218  0.020     -1.029 -0.367 24.759 1.025    11.119     -51.511   928.416      -47.568       -0.153
 LONG RETEST_CONFIRMED       TP_2ATR      294.0   294.0   3.370  0.011     -1.020 -0.116 38.095 1.017     6.037     -22.455   766.386        3.033        0.010
 LONG    CLOSE_CONFIRM       TP_2ATR      638.0   638.0  -0.289 -0.000      0.377 -0.049 52.821 0.999    14.450     -14.446 -4892.162       -0.289       -0.000
SHORT    CLOSE_CONFIRM       TP_1ATR      570.0   570.0  -5.563 -0.010      0.268 -0.030 64.737 0.974     7.558     -16.559  -197.667       -5.563       -0.010
SHORT RETEST_CONFIRMED       TP_1ATR      311.0   311.0  -5.771 -0.019      0.293 -0.074 51.447 0.964     3.650     -19.874  -244.345       -5.771       -0.019
 LONG    CLOSE_CONFIRM BE_THEN_TRAIL      638.0   638.0 -13.322 -0.021     -0.089 -0.129 47.649 0.958    30.475     -38.822  -191.413      -16.008       -0.025
SHORT     RETEST_TOUCH   SWING_TRAIL      281.0   281.0 -15.479 -0.055     -0.438 -0.391 17.082 0.889     4.132     -77.666  -401.745      -53.891       -0.192
SHORT    CLOSE_CONFIRM   SWING_TRAIL      570.0   570.0 -18.571 -0.033     -0.300 -0.206 22.632 0.904     8.586     -66.327  -257.143      -42.082       -0.074
SHORT    CLOSE_CONFIRM       TP_2ATR      570.0   570.0 -44.883 -0.079     -1.007 -0.166 46.140 0.860    12.225     -63.568   -41.630      -44.954       -0.079
SHORT    CLOSE_CONFIRM     TIME_FAST      570.0   570.0 -50.038 -0.088     -1.011 -0.331 30.000 0.867    15.986    -103.695  -107.233      -84.732       -0.149

## (a2) Sin top5/winsor

 side       entry_mode    exit_model  trades   net_R  net_exTop5     %top5  net_winsor5  avg_winsor5  mediana_R    PF
 LONG     RETEST_TOUCH       TP_2ATR   257.0  64.707      33.637    48.017       62.141        0.242     -1.036 1.330
SHORT     RETEST_TOUCH       TP_1ATR   281.0  36.998      20.910    43.483       36.998        0.132     -1.023 1.233
SHORT     RETEST_TOUCH       TP_2ATR   281.0  36.380       5.044    86.134       28.245        0.101     -1.041 1.171
SHORT RETEST_CONFIRMED       TP_2ATR   311.0  19.226      -7.303   137.984       16.439        0.053     -1.023 1.095
 LONG    CLOSE_CONFIRM       TP_2ATR   638.0  -0.289     -14.446 -4892.162       -0.289       -0.000      0.377 0.999
SHORT    CLOSE_CONFIRM       TP_1ATR   570.0  -5.563     -16.559  -197.667       -5.563       -0.010      0.268 0.974
SHORT RETEST_CONFIRMED       TP_1ATR   311.0  -5.771     -19.874  -244.345       -5.771       -0.019      0.293 0.964
 LONG RETEST_CONFIRMED BE_THEN_TRAIL   294.0  31.814     -20.065   163.070        4.285        0.015     -1.008 1.196
 LONG RETEST_CONFIRMED       TP_2ATR   294.0   3.370     -22.455   766.386        3.033        0.010     -1.020 1.017
 LONG    CLOSE_CONFIRM BE_THEN_TRAIL   638.0 -13.322     -38.822  -191.413      -16.008       -0.025     -0.089 0.958
 LONG     RETEST_TOUCH BE_THEN_TRAIL   257.0   8.336     -38.951   567.239      -15.582       -0.061     -0.105 1.068
SHORT RETEST_CONFIRMED   SWING_TRAIL   311.0   8.322     -42.223   607.360      -18.781       -0.060     -0.551 1.050
SHORT RETEST_CONFIRMED     TIME_FAST   311.0   6.218     -51.511   928.416      -47.568       -0.153     -1.029 1.025
SHORT    CLOSE_CONFIRM       TP_2ATR   570.0 -44.883     -63.568   -41.630      -44.954       -0.079     -1.007 0.860
SHORT    CLOSE_CONFIRM   SWING_TRAIL   570.0 -18.571     -66.327  -257.143      -42.082       -0.074     -0.300 0.904
SHORT     RETEST_TOUCH     TIME_FAST   281.0  18.988     -67.209   453.961      -84.099       -0.299     -1.052 1.075
SHORT     RETEST_TOUCH   SWING_TRAIL   281.0 -15.479     -77.666  -401.745      -53.891       -0.192     -0.438 0.889
SHORT    CLOSE_CONFIRM     TIME_FAST   570.0 -50.038    -103.695  -107.233      -84.732       -0.149     -1.011 0.867

## (b) Entradas

      entry_mode  n_signals  trades    net_R  avg_R  mediana_R  trim5   win%    PF  avg_bars  net_exTop5   %top5  net_winsor5  avg_winsor5
   CLOSE_CONFIRM     1208.0  3556.0 -132.666 -0.037     -0.296 -0.161 44.235 0.923    15.170    -193.461 -45.825     -193.628       -0.054
RETEST_CONFIRMED      605.0  1832.0   63.179  0.034     -1.015 -0.191 37.773 1.056     7.192      -3.314 105.246      -48.364       -0.026
    RETEST_TOUCH      538.0  1638.0  149.931  0.092     -1.027 -0.208 31.258 1.138     4.603      57.938  61.357      -26.187       -0.016

## (c) Sensibilidad

 cost  minrisk                               combo  trades    net    avg
 0.25      0.2    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     638  -1.76 -0.003
 0.25      0.2          LONG|CLOSE_CONFIRM|TP_2ATR     638  13.73  0.022
 0.25      0.2 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     303  38.15  0.126
 0.25      0.2       LONG|RETEST_CONFIRMED|TP_2ATR     303  19.42  0.064
 0.25      0.2     LONG|RETEST_TOUCH|BE_THEN_TRAIL     281  46.48  0.165
 0.25      0.2           LONG|RETEST_TOUCH|TP_2ATR     281  99.36  0.354
 0.25      0.2     SHORT|CLOSE_CONFIRM|SWING_TRAIL     570  -4.97 -0.009
 0.25      0.2       SHORT|CLOSE_CONFIRM|TIME_FAST     570 -36.75 -0.064
 0.25      0.2         SHORT|CLOSE_CONFIRM|TP_1ATR     570  12.34  0.022
 0.25      0.2         SHORT|CLOSE_CONFIRM|TP_2ATR     570 -29.49 -0.052
 0.25      0.2  SHORT|RETEST_CONFIRMED|SWING_TRAIL     319  19.82  0.062
 0.25      0.2    SHORT|RETEST_CONFIRMED|TIME_FAST     319  20.73  0.065
 0.25      0.2      SHORT|RETEST_CONFIRMED|TP_1ATR     319  13.50  0.042
 0.25      0.2      SHORT|RETEST_CONFIRMED|TP_2ATR     319  41.67  0.131
 0.25      0.2      SHORT|RETEST_TOUCH|SWING_TRAIL     304  25.11  0.083
 0.25      0.2        SHORT|RETEST_TOUCH|TIME_FAST     304  57.14  0.188
 0.25      0.2          SHORT|RETEST_TOUCH|TP_1ATR     304  82.52  0.271
 0.25      0.2          SHORT|RETEST_TOUCH|TP_2ATR     304  60.13  0.198
 0.50      0.2    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     638 -13.32 -0.021
 0.50      0.2          LONG|CLOSE_CONFIRM|TP_2ATR     638  -0.29 -0.000
 0.50      0.2 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     303  26.24  0.087
 0.50      0.2       LONG|RETEST_CONFIRMED|TP_2ATR     303   3.28  0.011
 0.50      0.2     LONG|RETEST_TOUCH|BE_THEN_TRAIL     284  43.05  0.152
 0.50      0.2           LONG|RETEST_TOUCH|TP_2ATR     284  95.55  0.336
 0.50      0.2     SHORT|CLOSE_CONFIRM|SWING_TRAIL     570 -18.57 -0.033
 0.50      0.2       SHORT|CLOSE_CONFIRM|TIME_FAST     570 -50.04 -0.088
 0.50      0.2         SHORT|CLOSE_CONFIRM|TP_1ATR     570  -5.56 -0.010
 0.50      0.2         SHORT|CLOSE_CONFIRM|TP_2ATR     570 -44.88 -0.079
 0.50      0.2  SHORT|RETEST_CONFIRMED|SWING_TRAIL     321   4.04  0.013
 0.50      0.2    SHORT|RETEST_CONFIRMED|TIME_FAST     321   4.83  0.015
 0.50      0.2      SHORT|RETEST_CONFIRMED|TP_1ATR     321  -2.12 -0.007
 0.50      0.2      SHORT|RETEST_CONFIRMED|TP_2ATR     321  26.78  0.083
 0.50      0.2      SHORT|RETEST_TOUCH|SWING_TRAIL     310  -3.10 -0.010
 0.50      0.2        SHORT|RETEST_TOUCH|TIME_FAST     310  27.70  0.089
 0.50      0.2          SHORT|RETEST_TOUCH|TP_1ATR     310  48.13  0.155
 0.50      0.2          SHORT|RETEST_TOUCH|TP_2ATR     310  32.30  0.104
 0.75      0.2    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     638 -24.27 -0.038
 0.75      0.2          LONG|CLOSE_CONFIRM|TP_2ATR     638 -16.45 -0.026
 0.75      0.2 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     303  21.32  0.070
 0.75      0.2       LONG|RETEST_CONFIRMED|TP_2ATR     303  -7.18 -0.024
 0.75      0.2     LONG|RETEST_TOUCH|BE_THEN_TRAIL     290   1.99  0.007
 0.75      0.2           LONG|RETEST_TOUCH|TP_2ATR     290  61.25  0.211
 0.75      0.2     SHORT|CLOSE_CONFIRM|SWING_TRAIL     570 -31.65 -0.056
 0.75      0.2       SHORT|CLOSE_CONFIRM|TIME_FAST     570 -62.82 -0.110
 0.75      0.2         SHORT|CLOSE_CONFIRM|TP_1ATR     570 -20.25 -0.036
 0.75      0.2         SHORT|CLOSE_CONFIRM|TP_2ATR     570 -55.05 -0.097
 0.75      0.2  SHORT|RETEST_CONFIRMED|SWING_TRAIL     324 -12.52 -0.039
 0.75      0.2    SHORT|RETEST_CONFIRMED|TIME_FAST     324 -11.84 -0.037
 0.75      0.2      SHORT|RETEST_CONFIRMED|TP_1ATR     324 -21.35 -0.066
 0.75      0.2      SHORT|RETEST_CONFIRMED|TP_2ATR     324  11.12  0.034
 0.75      0.2      SHORT|RETEST_TOUCH|SWING_TRAIL     313 -20.15 -0.064
 0.75      0.2        SHORT|RETEST_TOUCH|TIME_FAST     313  25.62  0.082
 0.75      0.2          SHORT|RETEST_TOUCH|TP_1ATR     313  21.02  0.067
 0.75      0.2          SHORT|RETEST_TOUCH|TP_2ATR     313   1.79  0.006
 0.25      0.3    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     638  -1.76 -0.003
 0.25      0.3          LONG|CLOSE_CONFIRM|TP_2ATR     638  13.73  0.022
 0.25      0.3 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     294  43.27  0.147
 0.25      0.3       LONG|RETEST_CONFIRMED|TP_2ATR     294  18.53  0.063
 0.25      0.3     LONG|RETEST_TOUCH|BE_THEN_TRAIL     249  23.63  0.095
 0.25      0.3           LONG|RETEST_TOUCH|TP_2ATR     249  75.40  0.303
 0.25      0.3     SHORT|CLOSE_CONFIRM|SWING_TRAIL     570  -4.97 -0.009
 0.25      0.3       SHORT|CLOSE_CONFIRM|TIME_FAST     570 -36.75 -0.064
 0.25      0.3         SHORT|CLOSE_CONFIRM|TP_1ATR     570  12.34  0.022
 0.25      0.3         SHORT|CLOSE_CONFIRM|TP_2ATR     570 -29.49 -0.052
 0.25      0.3  SHORT|RETEST_CONFIRMED|SWING_TRAIL     309  20.62  0.067
 0.25      0.3    SHORT|RETEST_CONFIRMED|TIME_FAST     309  21.41  0.069
 0.25      0.3      SHORT|RETEST_CONFIRMED|TP_1ATR     309   4.48  0.015
 0.25      0.3      SHORT|RETEST_CONFIRMED|TP_2ATR     309  25.11  0.081
 0.25      0.3      SHORT|RETEST_TOUCH|SWING_TRAIL     274   5.86  0.021
 0.25      0.3        SHORT|RETEST_TOUCH|TIME_FAST     274  24.61  0.090
 0.25      0.3          SHORT|RETEST_TOUCH|TP_1ATR     274  50.32  0.184
 0.25      0.3          SHORT|RETEST_TOUCH|TP_2ATR     274  45.62  0.166
 0.50      0.3    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     638 -13.32 -0.021
 0.50      0.3          LONG|CLOSE_CONFIRM|TP_2ATR     638  -0.29 -0.000
 0.50      0.3 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     294  31.81  0.108
 0.50      0.3       LONG|RETEST_CONFIRMED|TP_2ATR     294   3.37  0.011
 0.50      0.3     LONG|RETEST_TOUCH|BE_THEN_TRAIL     257   8.34  0.032
 0.50      0.3           LONG|RETEST_TOUCH|TP_2ATR     257  64.71  0.252
 0.50      0.3     SHORT|CLOSE_CONFIRM|SWING_TRAIL     570 -18.57 -0.033
 0.50      0.3       SHORT|CLOSE_CONFIRM|TIME_FAST     570 -50.04 -0.088
 0.50      0.3         SHORT|CLOSE_CONFIRM|TP_1ATR     570  -5.56 -0.010
 0.50      0.3         SHORT|CLOSE_CONFIRM|TP_2ATR     570 -44.88 -0.079
 0.50      0.3  SHORT|RETEST_CONFIRMED|SWING_TRAIL     311   8.32  0.027
 0.50      0.3    SHORT|RETEST_CONFIRMED|TIME_FAST     311   6.22  0.020
 0.50      0.3      SHORT|RETEST_CONFIRMED|TP_1ATR     311  -5.77 -0.019
 0.50      0.3      SHORT|RETEST_CONFIRMED|TP_2ATR     311  19.23  0.062
 0.50      0.3      SHORT|RETEST_TOUCH|SWING_TRAIL     281 -15.48 -0.055
 0.50      0.3        SHORT|RETEST_TOUCH|TIME_FAST     281  18.99  0.068
 0.50      0.3          SHORT|RETEST_TOUCH|TP_1ATR     281  37.00  0.132
 0.50      0.3          SHORT|RETEST_TOUCH|TP_2ATR     281  36.38  0.129
 0.75      0.3    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     638 -24.27 -0.038
 0.75      0.3          LONG|CLOSE_CONFIRM|TP_2ATR     638 -16.45 -0.026
 0.75      0.3 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     297  25.97  0.087
 0.75      0.3       LONG|RETEST_CONFIRMED|TP_2ATR     297  -9.74 -0.033
 0.75      0.3     LONG|RETEST_TOUCH|BE_THEN_TRAIL     267  -0.13 -0.000
 0.75      0.3           LONG|RETEST_TOUCH|TP_2ATR     267  50.31  0.188
 0.75      0.3     SHORT|CLOSE_CONFIRM|SWING_TRAIL     570 -31.65 -0.056
 0.75      0.3       SHORT|CLOSE_CONFIRM|TIME_FAST     570 -62.82 -0.110
 0.75      0.3         SHORT|CLOSE_CONFIRM|TP_1ATR     570 -20.25 -0.036
 0.75      0.3         SHORT|CLOSE_CONFIRM|TP_2ATR     570 -55.05 -0.097
 0.75      0.3  SHORT|RETEST_CONFIRMED|SWING_TRAIL     312  -4.85 -0.016
 0.75      0.3    SHORT|RETEST_CONFIRMED|TIME_FAST     312  -7.21 -0.023
 0.75      0.3      SHORT|RETEST_CONFIRMED|TP_1ATR     312 -17.30 -0.055
 0.75      0.3      SHORT|RETEST_CONFIRMED|TP_2ATR     312   7.19  0.023
 0.75      0.3      SHORT|RETEST_TOUCH|SWING_TRAIL     289 -38.60 -0.134
 0.75      0.3        SHORT|RETEST_TOUCH|TIME_FAST     289  -6.99 -0.024
 0.75      0.3          SHORT|RETEST_TOUCH|TP_1ATR     289  10.54  0.036
 0.75      0.3          SHORT|RETEST_TOUCH|TP_2ATR     289  -6.74 -0.023
 0.25      0.4    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     637  -1.76 -0.003
 0.25      0.4          LONG|CLOSE_CONFIRM|TP_2ATR     637  14.79  0.023
 0.25      0.4 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     283  29.93  0.106
 0.25      0.4       LONG|RETEST_CONFIRMED|TP_2ATR     283   9.45  0.033
 0.25      0.4     LONG|RETEST_TOUCH|BE_THEN_TRAIL     207   0.73  0.004
 0.25      0.4           LONG|RETEST_TOUCH|TP_2ATR     207  54.44  0.263
 0.25      0.4     SHORT|CLOSE_CONFIRM|SWING_TRAIL     564  -2.92 -0.005
 0.25      0.4       SHORT|CLOSE_CONFIRM|TIME_FAST     564 -30.53 -0.054
 0.25      0.4         SHORT|CLOSE_CONFIRM|TP_1ATR     564  10.85  0.019
 0.25      0.4         SHORT|CLOSE_CONFIRM|TP_2ATR     564 -29.60 -0.052
 0.25      0.4  SHORT|RETEST_CONFIRMED|SWING_TRAIL     295  15.88  0.054
 0.25      0.4    SHORT|RETEST_CONFIRMED|TIME_FAST     295  13.14  0.045
 0.25      0.4      SHORT|RETEST_CONFIRMED|TP_1ATR     295   3.41  0.012
 0.25      0.4      SHORT|RETEST_CONFIRMED|TP_2ATR     295  19.78  0.067
 0.25      0.4      SHORT|RETEST_TOUCH|SWING_TRAIL     239  -2.33 -0.010
 0.25      0.4        SHORT|RETEST_TOUCH|TIME_FAST     239  22.22  0.093
 0.25      0.4          SHORT|RETEST_TOUCH|TP_1ATR     239  35.79  0.150
 0.25      0.4          SHORT|RETEST_TOUCH|TP_2ATR     239  19.38  0.081
 0.50      0.4    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     637 -13.21 -0.021
 0.50      0.4          LONG|CLOSE_CONFIRM|TP_2ATR     637   0.82  0.001
 0.50      0.4 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     287  15.46  0.054
 0.50      0.4       LONG|RETEST_CONFIRMED|TP_2ATR     287  -8.91 -0.031
 0.50      0.4     LONG|RETEST_TOUCH|BE_THEN_TRAIL     209   1.74  0.008
 0.50      0.4           LONG|RETEST_TOUCH|TP_2ATR     209  47.83  0.229
 0.50      0.4     SHORT|CLOSE_CONFIRM|SWING_TRAIL     564 -16.18 -0.029
 0.50      0.4       SHORT|CLOSE_CONFIRM|TIME_FAST     564 -43.62 -0.077
 0.50      0.4         SHORT|CLOSE_CONFIRM|TP_1ATR     564  -6.61 -0.012
 0.50      0.4         SHORT|CLOSE_CONFIRM|TP_2ATR     564 -44.60 -0.079
 0.50      0.4  SHORT|RETEST_CONFIRMED|SWING_TRAIL     298   4.10  0.014
 0.50      0.4    SHORT|RETEST_CONFIRMED|TIME_FAST     298  11.73  0.039
 0.50      0.4      SHORT|RETEST_CONFIRMED|TP_1ATR     298  -7.60 -0.026
 0.50      0.4      SHORT|RETEST_CONFIRMED|TP_2ATR     298  12.50  0.042
 0.50      0.4      SHORT|RETEST_TOUCH|SWING_TRAIL     244 -15.88 -0.065
 0.50      0.4        SHORT|RETEST_TOUCH|TIME_FAST     244   2.99  0.012
 0.50      0.4          SHORT|RETEST_TOUCH|TP_1ATR     244  14.72  0.060
 0.50      0.4          SHORT|RETEST_TOUCH|TP_2ATR     244   7.83  0.032
 0.75      0.4    LONG|CLOSE_CONFIRM|BE_THEN_TRAIL     637 -24.05 -0.038
 0.75      0.4          LONG|CLOSE_CONFIRM|TP_2ATR     637 -15.29 -0.024
 0.75      0.4 LONG|RETEST_CONFIRMED|BE_THEN_TRAIL     289  10.87  0.038
 0.75      0.4       LONG|RETEST_CONFIRMED|TP_2ATR     289 -13.94 -0.048
 0.75      0.4     LONG|RETEST_TOUCH|BE_THEN_TRAIL     218 -13.68 -0.063
 0.75      0.4           LONG|RETEST_TOUCH|TP_2ATR     218  30.87  0.142
 0.75      0.4     SHORT|CLOSE_CONFIRM|SWING_TRAIL     566 -29.91 -0.053
 0.75      0.4       SHORT|CLOSE_CONFIRM|TIME_FAST     566 -58.43 -0.103
 0.75      0.4         SHORT|CLOSE_CONFIRM|TP_1ATR     566 -19.63 -0.035
 0.75      0.4         SHORT|CLOSE_CONFIRM|TP_2ATR     566 -50.66 -0.090
 0.75      0.4  SHORT|RETEST_CONFIRMED|SWING_TRAIL     299  -8.13 -0.027
 0.75      0.4    SHORT|RETEST_CONFIRMED|TIME_FAST     299  -1.08 -0.004
 0.75      0.4      SHORT|RETEST_CONFIRMED|TP_1ATR     299 -22.42 -0.075
 0.75      0.4      SHORT|RETEST_CONFIRMED|TP_2ATR     299   1.63  0.005
 0.75      0.4      SHORT|RETEST_TOUCH|SWING_TRAIL     250 -30.67 -0.123
 0.75      0.4        SHORT|RETEST_TOUCH|TIME_FAST     250 -17.00 -0.068
 0.75      0.4          SHORT|RETEST_TOUCH|TP_1ATR     250  -3.39 -0.014
 0.75      0.4          SHORT|RETEST_TOUCH|TP_2ATR     250 -16.48 -0.066

## (d1) Temporal dev/val/test net_R

seg                                     dev   test    val
side  entry_mode       exit_model                        
LONG  CLOSE_CONFIRM    BE_THEN_TRAIL  12.21  -6.17 -19.37
                       TP_2ATR        11.43  13.91 -25.62
      RETEST_CONFIRMED BE_THEN_TRAIL  17.11  27.88 -13.17
                       TP_2ATR         3.94  24.33 -24.90
      RETEST_TOUCH     BE_THEN_TRAIL   9.13 -11.17  10.38
                       TP_2ATR        34.10  29.88   0.73
SHORT CLOSE_CONFIRM    SWING_TRAIL   -23.22  15.16 -10.51
                       TIME_FAST     -39.82   4.89 -15.12
                       TP_1ATR         5.96   0.30 -11.81
                       TP_2ATR        -5.88  -8.61 -30.39
      RETEST_CONFIRMED SWING_TRAIL   -18.15  18.32   8.16
                       TIME_FAST       5.10   5.53  -4.42
                       TP_1ATR         8.96 -18.47   3.74
                       TP_2ATR        21.82  -5.59   2.99
      RETEST_TOUCH     SWING_TRAIL   -26.03  13.33  -2.77
                       TIME_FAST      18.69  -3.56   3.86
                       TP_1ATR        29.69   6.14   1.17
                       TP_2ATR        27.74  -5.28  13.92

## (d2) Mensual/trimestral

                              combo  meses_pos  meses_tot  trim_pos  trim_tot  mejor_trim  peor_trim  pct_top5
   LONG|CLOSE_CONFIRM|BE_THEN_TRAIL         13         28         3        10       35.72     -24.83    -191.4
         LONG|CLOSE_CONFIRM|TP_2ATR         14         28         4        10       19.59     -24.36   -4892.2
LONG|RETEST_CONFIRMED|BE_THEN_TRAIL         16         28         5        10       25.17     -16.25     163.1
      LONG|RETEST_CONFIRMED|TP_2ATR         12         28         5        10       20.92     -19.45     766.4
    LONG|RETEST_TOUCH|BE_THEN_TRAIL         11         28         6        10       22.14     -11.19     567.2
          LONG|RETEST_TOUCH|TP_2ATR         16         28         8        10       26.39     -15.33      48.0
    SHORT|CLOSE_CONFIRM|SWING_TRAIL          9         28         4        10       15.45     -12.55    -257.1
      SHORT|CLOSE_CONFIRM|TIME_FAST          7         28         3        10       19.49     -29.21    -107.2
        SHORT|CLOSE_CONFIRM|TP_1ATR         14         28         4        10       11.54      -6.77    -197.7
        SHORT|CLOSE_CONFIRM|TP_2ATR          8         28         4        10        7.06     -20.89     -41.6
 SHORT|RETEST_CONFIRMED|SWING_TRAIL         11         28         5        10       15.41     -11.29     607.4
   SHORT|RETEST_CONFIRMED|TIME_FAST         14         28         5        10       12.48     -10.44     928.4
     SHORT|RETEST_CONFIRMED|TP_1ATR         10         28         4        10       11.80     -12.38    -244.3
     SHORT|RETEST_CONFIRMED|TP_2ATR         11         28         6        10       12.28      -6.98     138.0
     SHORT|RETEST_TOUCH|SWING_TRAIL          8         28         4        10       24.35     -13.90    -401.7
       SHORT|RETEST_TOUCH|TIME_FAST         10         28         5        10       20.08     -14.24     454.0
         SHORT|RETEST_TOUCH|TP_1ATR         17         28         7        10       10.22      -7.69      43.5
         SHORT|RETEST_TOUCH|TP_2ATR         15         28         6        10       18.96     -12.50      86.1

## (e) Bootstrap x signal_id

                              combo   n  boot_mean  net_p5  net_p95  pf_mean  pf_p5  pf_p95
   LONG|CLOSE_CONFIRM|BE_THEN_TRAIL 638     -17.12  -61.38    27.74    0.949  0.813   1.090
         LONG|CLOSE_CONFIRM|TP_2ATR 638      -1.48  -37.35    40.62    0.998  0.885   1.136
LONG|RETEST_CONFIRMED|BE_THEN_TRAIL 294      31.25  -22.40    94.98    1.203  0.865   1.632
      LONG|RETEST_CONFIRMED|TP_2ATR 294       3.71  -40.68    48.97    1.026  0.809   1.263
    LONG|RETEST_TOUCH|BE_THEN_TRAIL 257      11.85  -36.27    66.07    1.103  0.724   1.561
          LONG|RETEST_TOUCH|TP_2ATR 257      63.58    7.92   113.02    1.333  1.038   1.647
    SHORT|CLOSE_CONFIRM|SWING_TRAIL 570     -16.33  -67.71    37.30    0.919  0.678   1.193
      SHORT|CLOSE_CONFIRM|TIME_FAST 570     -46.73 -120.30    18.60    0.878  0.689   1.052
        SHORT|CLOSE_CONFIRM|TP_1ATR 570      -4.53  -37.47    26.83    0.983  0.839   1.138
        SHORT|CLOSE_CONFIRM|TP_2ATR 570     -42.84  -83.13    -1.34    0.868  0.757   0.996
 SHORT|RETEST_CONFIRMED|SWING_TRAIL 311      11.71  -47.33    57.38    1.076  0.737   1.376
   SHORT|RETEST_CONFIRMED|TIME_FAST 311      10.52  -59.90    76.40    1.047  0.765   1.328
     SHORT|RETEST_CONFIRMED|TP_1ATR 311      -7.16  -41.31    22.26    0.962  0.769   1.150
     SHORT|RETEST_CONFIRMED|TP_2ATR 311      19.28  -24.14    67.82    1.101  0.888   1.361
     SHORT|RETEST_TOUCH|SWING_TRAIL 281     -15.77  -66.20    47.29    0.892  0.537   1.372
       SHORT|RETEST_TOUCH|TIME_FAST 281      13.87  -74.41   113.40    1.059  0.711   1.471
         SHORT|RETEST_TOUCH|TP_1ATR 281      39.22    4.07    78.32    1.258  1.024   1.545
         SHORT|RETEST_TOUCH|TP_2ATR 281      40.32   -7.78    96.98    1.196  0.965   1.491


## (f) Score vs R (terciles, sin filtrar)

corr(evidence,R)=-0.0332
    count   mean      sum
q                        
T1   2348  0.033   77.692
T2   2342  0.059  137.695
T3   2336 -0.058 -134.944
corr(node_strength,R)=-0.0261
    count   mean      sum
q                        
T1   2348  0.063  146.752
T2   2336  0.043  100.407
T3   2342 -0.071 -166.717
corr(absorption,R)=0.0191
    count   mean     sum
q                       
T1   4684  0.002   9.780
T2   2342  0.030  70.664
corr(score,R)=0.0177
    count   mean      sum
q                        
T1   2342 -0.018  -42.643
T2   2344 -0.044 -103.568
T3   2340  0.097  226.654

## (g) Veredicto: si net_exTop5<0 y p5 bootstrap<0 en todos los combos, el edge NO sobrevive a costes.
