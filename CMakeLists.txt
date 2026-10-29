cmake_minimum_required(VERSION 3.20)
project(AtCoder C CXX)

# C++23標準を使用
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ライブラリディレクトリをインクルードパスに追加
# 各問題コードから `#include "SegmentTree.cpp"` やヘッダーファイルを直接 include 可能
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/lib)

# プロジェクト内の全 .cpp / .c ファイルを自動検出
# CONFIGURE_DEPENDS により、新しいファイルやフォルダを追加した際に自動認識
file(GLOB_RECURSE SRC_FILES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/*.c"
)

foreach(SRC ${SRC_FILES})
    # ビルド出力ディレクトリ、.idea、.git などを除外
    if(SRC MATCHES "/cmake-build-" OR SRC MATCHES "\\\\cmake-build-" OR
       SRC MATCHES "/\\.idea" OR SRC MATCHES "\\\\\\.idea" OR
       SRC MATCHES "/\\.git" OR SRC MATCHES "\\\\\\.git")
        continue()
    endif()

    # 相対パスを取得
    file(RELATIVE_PATH REL_SRC "${CMAKE_CURRENT_SOURCE_DIR}" "${SRC}")

    get_filename_component(DIR_PATH "${REL_SRC}" DIRECTORY)
    get_filename_component(NAME_WE "${REL_SRC}" NAME_WE)
    get_filename_component(EXT "${REL_SRC}" EXT)

    # ターゲット名の一意な生成
    # 例: apg4b/a.cpp       -> apg4b_a
    #     apg4b/a.c         -> apg4b_a_c
    #     lib/SegmentTree.cpp -> lib_SegmentTree
    #     abc350/a.cpp      -> abc350_a
    if(DIR_PATH STREQUAL "" OR DIR_PATH STREQUAL ".")
        set(BASE_TARGET "${NAME_WE}")
    else()
        string(REPLACE "/" "_" SAFE_DIR "${DIR_PATH}")
        string(REPLACE "\\" "_" SAFE_DIR "${SAFE_DIR}")
        set(BASE_TARGET "${SAFE_DIR}_${NAME_WE}")
    endif()

    if(EXT STREQUAL ".c")
        set(TARGET_NAME "${BASE_TARGET}_c")
    else()
        set(TARGET_NAME "${BASE_TARGET}")
    endif()

    add_executable(${TARGET_NAME} "${SRC}")

    # C++ターゲットの場合は <bits/stdc++.h> のプリコンパイル済みヘッダー(PCH)を共有適用
    # 1度だけ生成した PCH キャッシュを全ターゲットで共有してコンパイルを大幅に高速化
    if(NOT EXT STREQUAL ".c")
        if(NOT DEFINED PCH_MASTER_TARGET)
            set(PCH_MASTER_TARGET "${TARGET_NAME}")
            target_precompile_headers(${TARGET_NAME} PRIVATE <bits/stdc++.h>)
        else()
            target_precompile_headers(${TARGET_NAME} REUSE_FROM ${PCH_MASTER_TARGET})
        endif()
    endif()

    # lib/ 配下のファイルを単体ターゲットとして実行する場合のみ、
    # BUILDING_LIB_STANDALONE を定義してライブラリ内の main() を有効化する
    # 他のファイルから #include されたときはこのマクロが定義されないため、ライブラリの main() は無視される
    if(REL_SRC MATCHES "^lib[/\\\\]")
        target_compile_definitions(${TARGET_NAME} PRIVATE BUILDING_LIB_STANDALONE)
    endif()
endforeach()

# Auto-reload trigger: abc480 (2026-10-29T03:48:06.025Z)
