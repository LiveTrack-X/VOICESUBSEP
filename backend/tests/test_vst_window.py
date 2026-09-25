from voicesubsep.vst_window import editor_origin


def test_restores_title_bar_above_primary_work_area():
    assert editor_origin((-8, -31, 1048, 686), (0, 0, 1920, 1040)) == (0, 0)


def test_preserves_position_inside_secondary_monitor():
    assert editor_origin((-1700, 80, -800, 780), (-1920, 0, 0, 1040)) == (-1700, 80)


def test_keeps_close_corner_reachable_for_fixed_oversized_gui():
    assert editor_origin((0, 0, 2000, 1400), (0, 0, 1280, 720)) == (-720, 0)


def test_does_not_resize_and_clamps_right_bottom_edge():
    assert editor_origin((1700, 900, 1900, 1100), (0, 40, 1800, 1000)) == (1600, 800)
