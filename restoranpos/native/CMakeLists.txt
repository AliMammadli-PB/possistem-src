cmake_minimum_required(VERSION 3.25)
project(restaurant_pos_core LANGUAGES C CXX VERSION 1.7.8)

# The WebAssembly demo build: the core throws PosError for every refusal, and
# Emscripten turns exception catching off unless asked.
if(EMSCRIPTEN)
    add_compile_options(-fexceptions)
    add_link_options(-fexceptions)
endif()

# ---------------------------------------------------------------- toolchain --
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_C_STANDARD 11)

# Static CRT so the shipped executable needs no VC++ redistributable on the
# restaurant's terminal.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# A single, predictable output location. The multi-config Visual Studio
# generator would append Debug/ or Release/ here, which breaks both the exe
# path resolution in Electron and the electron-builder extraResources glob -
# hence the Ninja single-config generator in scripts/build-core.mjs.
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

# Applied to everything, including vendored code.
if(MSVC)
    add_compile_options(
        /utf-8              # source and execution charset - required for Azerbaijani text
        /permissive-
        /Zc:__cplusplus
        /Zc:preprocessor
        /EHsc
        /MP
    )
    add_compile_definitions(
        NOMINMAX
        WIN32_LEAN_AND_MEAN
        UNICODE
        _UNICODE
        _CRT_SECURE_NO_WARNINGS
    )
    # Strict warnings only for our own code - setting /W4 globally and then
    # overriding it per third-party target emits D9025 on every file.
    set(POS_WARNING_FLAGS /W4 /wd4100)
else()
    add_compile_options(-Wno-unknown-pragmas)
    add_link_options(-static -static-libgcc -static-libstdc++)
    set(POS_WARNING_FLAGS -Wall -Wextra -Wno-unused-parameter)
endif()

# ------------------------------------------------------------- third party ---
set(TP ${CMAKE_CURRENT_SOURCE_DIR}/third_party)

foreach(dep sqlite nlohmann spdlog catch2)
    if(NOT EXISTS ${TP}/${dep})
        message(FATAL_ERROR
            "Vendored dependency '${dep}' is missing from native/third_party.\n"
            "Run:  node scripts/fetch-deps.mjs")
    endif()
endforeach()

# SQLite. Compile options are chosen for an embedded single-writer POS.
add_library(tp_sqlite3 STATIC ${TP}/sqlite/sqlite3.c)
target_include_directories(tp_sqlite3 PUBLIC ${TP}/sqlite)
target_compile_definitions(tp_sqlite3 PUBLIC
    SQLITE_THREADSAFE=1
    SQLITE_DQS=0                      # reject double-quoted string literals
    SQLITE_USE_URI=1
    SQLITE_DEFAULT_MEMSTATUS=0
    SQLITE_DEFAULT_FOREIGN_KEYS=1
    SQLITE_ENABLE_COLUMN_METADATA
    SQLITE_ENABLE_FTS5
    SQLITE_OMIT_DEPRECATED
    SQLITE_TRUSTED_SCHEMA=0
    SQLITE_ENABLE_MATH_FUNCTIONS
)

add_library(tp_json INTERFACE)
target_include_directories(tp_json INTERFACE ${TP}/nlohmann)

file(GLOB SPDLOG_SOURCES ${TP}/spdlog/src/*.cpp)
add_library(tp_spdlog STATIC ${SPDLOG_SOURCES})
target_include_directories(tp_spdlog PUBLIC ${TP}/spdlog/include)
target_compile_definitions(tp_spdlog PUBLIC SPDLOG_COMPILED_LIB)

# ---------------------------------------------------------------- core lib ---
# All logic lives in a static library so the test binary links the real code and
# sidecar/main.cpp stays a trivial stdio wiring shim.
file(GLOB_RECURSE CORE_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/core/src/*.cpp)

add_library(pos_core_lib STATIC ${CORE_SOURCES} ${TP}/qrcodegen/qrcodegen.cpp)
target_include_directories(pos_core_lib PRIVATE ${TP}/qrcodegen)
target_include_directories(pos_core_lib PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/core/include)
target_link_libraries(pos_core_lib PUBLIC tp_sqlite3 tp_json tp_spdlog)
target_compile_options(pos_core_lib PRIVATE ${POS_WARNING_FLAGS})

if(WIN32)
    # bcrypt provides BCryptDeriveKeyPBKDF2 for PIN hashing and BCryptGenRandom
    # for salts - no extra dependency needed.
    # gdi32 renders the raster receipt: Azerbaijani "Ə"/"ə" exist in no thermal
    # code page, so the fallback path draws the bill with a system font instead.
    # setupapi/cfgmgr32 enumerate USB printer-class devices and COM ports, so a
    # till printer can be found and written to without a vendor driver.
    # iphlpapi supplies the local subnet list and the ARP cache, which is how a
    # receipt printer sitting on the switch is discovered without the operator
    # having to know its IP address.
    target_link_libraries(pos_core_lib PUBLIC bcrypt winspool ws2_32 gdi32 setupapi cfgmgr32
                          iphlpapi)
endif()

target_compile_definitions(pos_core_lib PUBLIC
    POS_CORE_VERSION="${PROJECT_VERSION}"
)

# ----------------------------------------------------------------- sidecar ---
add_executable(restaurant_pos_core ${CMAKE_CURRENT_SOURCE_DIR}/sidecar/main.cpp)
set_target_properties(restaurant_pos_core PROPERTIES OUTPUT_NAME restaurant-pos-core)
target_link_libraries(restaurant_pos_core PRIVATE pos_core_lib)

# ---------------------------------------------------------------- web demo ---
# The same core in WebAssembly for the possistem.az live demo (emcmake cmake).
if(EMSCRIPTEN)
    add_executable(pos_core_wasm ${CMAKE_CURRENT_SOURCE_DIR}/wasm/demo_core.cpp)
    set_target_properties(pos_core_wasm PROPERTIES OUTPUT_NAME restaurant-pos-core SUFFIX ".mjs")
    target_link_libraries(pos_core_wasm PRIVATE pos_core_lib)
    target_link_options(pos_core_wasm PRIVATE
        -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node
        -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sSTACK_SIZE=2MB
        -sEXPORTED_FUNCTIONS=_pos_boot,_pos_call,_malloc,_free
        -sEXPORTED_RUNTIME_METHODS=ccall,FS,stringToUTF8,lengthBytesUTF8,UTF8ToString
        -fexceptions)
    return()
endif()

# ------------------------------------------------------------------- tests ---
enable_testing()

file(GLOB_RECURSE TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/tests/*.cpp)

if(TEST_SOURCES)
    add_executable(core_tests
        ${TEST_SOURCES}
        ${TP}/catch2/catch_amalgamated.cpp
    )
    target_include_directories(core_tests PRIVATE ${TP}/catch2)
    target_link_libraries(core_tests PRIVATE pos_core_lib)
    if(MSVC)
        target_compile_options(core_tests PRIVATE /bigobj)
    endif()

    add_test(NAME core_tests COMMAND core_tests --reporter compact)
endif()

message(STATUS "restaurant-pos-core ${PROJECT_VERSION} | ${CMAKE_BUILD_TYPE} | ${CMAKE_CXX_COMPILER_ID}")
