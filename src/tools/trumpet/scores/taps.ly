% 消灯ラッパ（Taps、米軍のビューグルの号令）。ハ調のビューグルの記譜で、B♭ 管のトランペットで吹くと長 2 度低く鳴る。
% Wikimedia Commons の楽譜「File:Bugle Calls Taps.svg」（Jazzmanian 作、2007 年、パブリックドメイン）を手で写した。
% https://commons.wikimedia.org/wiki/File:Bugle_Calls_Taps.svg
% 号令はパブリックドメイン。このファイルも著作権を主張しない。

\version "2.24.0"

\header {
  title = "Taps"
  source = "https://commons.wikimedia.org/wiki/File:Bugle_Calls_Taps.svg"
  copyright = "Public Domain"
}

taps = \relative c'' {
  \clef treble
  \key c \major
  \time 4/4
  \partial 4
  g8. g16 | c2.\fermata g8. c16 | e2.\fermata g,8 c |
  e4 g,8 c e4 g,8 c | e2.\fermata c8. e16 | g2 e4 c |
  g2. g8. g16 | c2.\fermata \bar "|."
}

\score {
  \new Staff { \tempo 4 = 40 \taps }
  \layout { }
  \midi { }
}
