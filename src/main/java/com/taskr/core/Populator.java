package com.taskr.core;

import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.UserStorage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;

public class Populator implements CommandLineRunner {

    @Autowired
    UserStorage userStorage;
    @Override
    public void run(String... args) throws Exception {
        User testUser = new User("sample user");
        TaskTemplate testTemplate = new TaskTemplate("Sample task Template");


        userStorage.save(testUser);
    }
}
