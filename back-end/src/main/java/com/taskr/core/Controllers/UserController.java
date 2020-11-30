package com.taskr.core.Controllers;

import com.taskr.core.Resources.User;
import com.taskr.core.Storages.UserStorage;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {

    private UserStorage userStorage;

    public UserController(UserStorage userStorage) {
        this.userStorage = userStorage;
    }

    @GetMapping("/api/user/(id)")
    public User retrieveUserById(Long id) {
        return userStorage.findById(id);
    }

    @PostMapping("/api/user/new")
    public Iterable<User> addNewUser(User user) {
        userStorage.save(user);
        return userStorage.findAll();
    }

    @GetMapping("/api/users")
    public Iterable<User> retrieveAllUsers() {
        return userStorage.findAll();
    }
}
