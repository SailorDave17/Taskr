package com.taskr.core;

import com.taskr.core.storages.UserStorage;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import static org.junit.jupiter.api.Assertions.assertNotNull;

@SpringBootTest
class TaskrBackendApplicationTests {
    @Autowired
    private UserStorage userStorage;

    @Test
    void contextLoads() {
        assertNotNull(userStorage);
    }

}
