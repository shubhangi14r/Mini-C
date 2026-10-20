(module
  (import "env" "print_int" (func $print_int (param i32)))
  (func $fact (param $n i32) (result i32)
    local.get $n
    i32.const 1
    i32.le_s
    if (result i32)
      i32.const 1
    else
      local.get $n
      local.get $n
      i32.const 1
      i32.sub
      call $fact
      i32.mul
    end)
  (func $main
    i32.const 5
    call $fact
    call $print_int)
  (export "main" (func $main)))