package com.taskr.core.Storages;

import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import org.springframework.stereotype.Service;

import java.util.Optional;

@Service
public class UserStorage {

    private UserRepository userRepo;
    private TaskTemplateRepository taskTemplateRepo;

    public UserStorage(UserRepository userRepo, TaskTemplateRepository taskTemplateRepo) {
        this.taskTemplateRepo = taskTemplateRepo;
        this.userRepo = userRepo;
    }

    public void updateAllUsers() {
        for (User user : userRepo.findAll()) {
            user.updateUser();
        }
    }

    public void save(User user) {
        this.userRepo.save(user);
    }

    public void deleteById(Long id) {
        userRepo.deleteById(id);
    }

    public void delete(User user) {
        userRepo.delete(user);
    }

    public Iterable<User> findAll() {
        return userRepo.findAll();
    }

    public User findById(Long id) {
        User dummyUser = new User("User not found");
        if (userRepo.findById(id).isPresent()) {
            return userRepo.findById(id).get();
        } else return dummyUser;
    }

    public User findUserByName(String name) {
        User dummyUser = new User("User not found");
        Optional<User> retrievedUserOptional = Optional.ofNullable(userRepo.findUserByName(name));
        if (retrievedUserOptional.isPresent()) {
            return retrievedUserOptional.get();
        } else return dummyUser;
    }
}
