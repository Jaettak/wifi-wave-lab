// 원본 도면과 사용자 확인 사항을 기준으로 새로 작성한 지도.
// 원본 이미지(1191×798)의 픽셀 좌표이며, 가구와 싱크대는 구조물에서 제외한다.
window.WIFI_LAYOUT = (() => {
  const S=(x1,y1,x2,y2,material='concrete',width=10)=>({x1,y1,x2,y2,material,width,kind:'segment'});
  const B=(x,y,w,h,material='concrete')=>({x,y,w,h,material,kind:'block'});
  const structure=[
    // 남쪽 외벽과 침실·거실·발코니·대피공간 창문
    S(239,625,260,625),S(260,625,344,625,'glass',7),S(344,625,385,625),
    S(385,625,467,625,'glass',7),S(467,625,505,625),
    S(505,625,689,625,'glass',7),S(689,625,695,625),
    S(695,625,802,625,'glass',7),S(802,625,826,625),
    S(826,625,855,625,'glass',7),S(855,625,866,625),
    // 서쪽과 현관 돌출부 외벽
    S(239,365,239,625),S(239,365,315,365),S(275,294,275,365),
    S(275,294,315,294),S(355,294,381,294),
    S(381,294,381,243),S(381,243,403,243),
    // 북쪽 외벽: 침실 3, 주방, 발코니 2, 오른쪽 작은 공간, 드레스룸의 창
    S(403,243,491,243,'glass',7),S(491,243,497,243),S(497,243,497,223),
    S(497,223,555,223),S(555,223,604,223,'glass',7),S(604,223,660,223),
    S(660,223,666,223),S(666,223,738,223,'glass',7),S(738,223,742,223),
    S(742,223,742,253),S(742,247,754,247),S(754,247,793,247,'glass',7),
    S(793,247,800,247),S(800,247,805,247),S(805,247,860,247,'glass',7),
    S(860,247,866,247),S(866,247,866,625),
    // 현관 옆 창고와 공용 욕실의 동쪽 경계는 x=315의 한 줄이다.
    // 창고 문과 욕실 문 사이의 콘크리트도 한 구간으로 이어 둔다.
    S(315,294,315,314),S(315,345,315,426),
    S(315,457,315,463),S(239,463,315,463),
    S(378,400,381,400),
    // 침실 1·2·3과 거실의 경계. 침실 1·2 사이는 가벽.
    S(360,463,448,463),S(485,463,488,463),
    S(365,463,365,625,'partition',8),S(488,463,488,625),
    S(381,294,381,400),S(381,400,383,400),S(423,400,497,400),
    S(497,243,497,400),
    // 발코니 2와 오른쪽 작은 공간
    S(660,223,660,274),S(660,311,660,335),
    S(742,292,800,292),S(742,292,742,338),
    // 수납공간 위 두꺼운 콘크리트. 욕실 안 오른쪽 작은 돌출부는 없다.
    B(660,318,82,27),
    S(660,338,660,350),S(660,389,660,400),
    S(660,400,713,400),S(713,400,742,400),S(713,338,713,400),
    // 부부욕실·파우더룸·드레스룸
    S(742,400,800,400),S(800,247,800,292),S(800,292,800,339),
    S(800,374,800,400),S(800,338,806,338),S(859,338,866,338),
    // 안방, 발코니 1과 대피공간
    S(695,400,695,407),S(695,444,695,625),
    S(802,573,866,573),
    S(806,573,806,585),S(806,618,806,625)
  ];
  const doors=[
    {id:'entry',label:'현관문',material:'iron',x1:315,y1:294,x2:355,y2:294,mechanism:'swing',hinge:'left',direction:'up'},
    {id:'closet',label:'현관 옆 창고',material:'metal',x1:315,y1:314,x2:315,y2:345,mechanism:'doubleVertical',direction:'right'},
    {id:'hall',label:'현관 유리 중문',material:'glass',x1:315,y1:400,x2:378,y2:400,mechanism:'tripleStack'},
    {id:'bath',label:'공용 욕실',material:'wood',x1:315,y1:426,x2:315,y2:457,mechanism:'swing',hinge:'bottom',direction:'left'},
    {id:'bed2',label:'침실 2',material:'wood',x1:315,y1:463,x2:360,y2:463,mechanism:'swing',hinge:'right',direction:'down'},
    {id:'bed1',label:'침실 1',material:'wood',x1:448,y1:463,x2:485,y2:463,mechanism:'swing',hinge:'right',direction:'down'},
    {id:'bed3',label:'침실 3',material:'wood',x1:383,y1:400,x2:423,y2:400,mechanism:'swing',hinge:'left',direction:'up'},
    {id:'balcony2',label:'발코니 2',material:'glass',x1:660,y1:274,x2:660,y2:311,mechanism:'swing',hinge:'bottom',direction:'right'},
    {id:'balcony2iron',label:'발코니 2 옆 작은 공간',material:'iron',x1:742,y1:253,x2:742,y2:292,mechanism:'swing',hinge:'bottom',direction:'right'},
    {id:'storage',label:'수납공간',material:'glass',x1:660,y1:350,x2:660,y2:389,mechanism:'doubleVertical',direction:'left'},
    {id:'bathGlass',label:'부부욕실 유리문',material:'glass',x1:742,y1:338,x2:800,y2:338,mechanism:'halfSlideLeft'},
    {id:'masterbath',label:'부부욕실 나무문',material:'wood',x1:800,y1:339,x2:800,y2:374,mechanism:'swing',hinge:'bottom',direction:'left'},
    {id:'dressing',label:'드레스룸',material:'glass',x1:806,y1:338,x2:859,y2:338,mechanism:'doubleHorizontal',direction:'down'},
    {id:'master',label:'안방',material:'wood',x1:695,y1:407,x2:695,y2:444,mechanism:'swing',hinge:'top',direction:'right'},
    {id:'balcony1',label:'발코니 1',material:'glass',x1:695,y1:573,x2:802,y2:573,mechanism:'halfSlideLeft'},
    {id:'evac',label:'발코니 1·대피공간',material:'iron',x1:806,y1:585,x2:806,y2:618,mechanism:'swing',hinge:'top',direction:'right'}
  ];
  const rooms=[
    ['침실 2',294,545,80],['침실 1',427,545,80],['거실',586,540,100],
    ['안방',780,510,75],['침실 3',439,328,80],['현관',343,350,45],
    ['주방',576,355,80],['발코니 2',699,268,62],['수납',685,375,38],
    ['욕실',273,420,43],['부부욕실',772,373,57],['파우더룸',833,373,57],
    ['드레스룸',834,283,53],['발코니 1',751,607,65],['대피',837,607,38]
  ];
  // 벽 끝을 돌아 문으로 접근하는 경로의 후보점. 도면의 열린 복도 쪽에 둔다.
  const navigation=[
    [505,446],[478,446],[370,447],[380,414],
    [686,411],[705,390],[648,414],[734,413],
    [805,412],[878,560],[878,635]
  ];
  return {structure,doors,rooms,navigation,router:[683,552],probe:[445,541]};
})();
